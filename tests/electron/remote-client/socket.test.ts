import { EventEmitter } from 'node:events';
import type { LookupFunction } from 'node:net';

import { WebSocket, WebSocketServer, type ServerOptions } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CH, type Channel } from '@shared/ipc-contract';
import {
  CALL_DEADLINE_MS,
  CALL_GIVE_UP_MS,
  CALL_TIMEOUT_CODE,
  POST_ATTACH_FRAME_MAX_BYTES,
  REMOTE_PROTOCOL_VERSION,
  type AttachAccepted,
  type AttachRefused,
  type AttachRequest,
  type CallFrame,
  type ErrorFrame,
  type EventFrame,
  type NotifyFrame,
  type ResultFrame,
} from '@shared/remote-contract';

import {
  CHANNEL_CLOSE_CODE,
  CHANNEL_TAG_BYTES,
  pskOfToken,
  respond,
  type SecureSocket,
} from '../../../electron/remote-channel/secure-socket';
import {
  AttachFrameTooLargeError,
  AttachRefusedError,
  CLIENT_ATTACH_TIMEOUT_MS,
  PRE_SUBSCRIBE_BUFFER,
  PairingRefusedError,
  AddressRefusedError,
  RELAY_SERVER_OFFLINE,
  RelayClosedError,
  RelayTargetError,
  RemoteCallError,
  ServerTooOldError,
  classifyCause,
  connectRemote,
  type ConnectRemoteDeps,
  type RemoteClient,
} from '../../../electron/remote-client/socket';

/**
 * The client socket (HIVE-144).
 *
 * Two kinds of test live here on purpose.
 *
 * Everything about frames — the handshake, correlation, the give-up deadline,
 * the size ceiling — runs against an injected fake, because none of it needs a
 * socket and a real one would only add flake.
 *
 * The **resolved-address fence** does not, and cannot. Its whole subject is
 * what a real `ws` client does with a `lookup` it was handed, and `@types/ws`
 * does not even model that option — a fake ctor asserting "we passed a
 * `lookup`" would be a test of this file's own belief about `ws`. So the two
 * arms of that fence drive the real `ws` client against a real
 * `WebSocketServer` on loopback, with only the resolver's answer varying
 * between them: `127.0.0.1` connects, `203.0.113.7` is refused before a TCP
 * connection exists. Same host string, same server, same code path; one number
 * different.
 */

const CREDENTIAL = { deviceId: 'd_9f2c', token: 's3cret' };

/** An `attach-accepted` with a snapshot a test can tell apart from an empty one. */
function accepted(overrides: Partial<AttachAccepted> = {}): AttachAccepted {
  return {
    kind: 'attach-accepted',
    protocol: REMOTE_PROTOCOL_VERSION,
    serverName: 'mini',
    snapshot: { [CH.appInfo]: { version: '0.10.1' } },
    ...overrides,
  };
}

/** How the fake's far end answers the hello (HIVE-428). */
type ServerMode =
  /** A current Hive: the real responder, keyed for {@link CREDENTIAL}. */
  | 'hive'
  /** A Hive that does not know this pairing: it closes with 1008 and says nothing. */
  | 'unpaired'
  /** A Hive from before the channel: it answers the binary hello with a text refusal. */
  | 'old-server'
  /** Nothing answers at all. */
  | 'silent';

/**
 * The far end of a {@link FakeSocket}: a `RawSocket` the real `respond` runs on, so the client's
 * handshake is checked by the same code a server uses rather than by a stub of it.
 */
class ServerEnd extends EventEmitter {
  private readonly client: FakeSocket;

  constructor(client: FakeSocket) {
    super();
    this.client = client;
  }

  send(data: Buffer | string): void {
    const isBinary = typeof data !== 'string';
    this.client.emit('message', isBinary ? data : Buffer.from(data), isBinary);
  }

  close(code?: number): void {
    this.client.emit('close', code ?? 1000);
  }

  terminate(): void {
    this.client.emit('close', 1006);
  }
}

/**
 * The `ws` surface `connectRemote` actually uses, with a real channel responder on the far end
 * (HIVE-428). `sent` is what the far end decrypted, in order, so a test reads the attach and every
 * frame after it as text, exactly as before the channel; `wire` is every raw frame.
 */
class FakeSocket extends EventEmitter {
  readonly sent: string[] = [];
  readonly wire: (Buffer | string)[] = [];
  closeCalls = 0;
  terminateCalls = 0;
  readonly url: string;
  readonly options: { lookup?: LookupFunction; family?: number; maxPayload?: number };
  private readonly server = new ServerEnd(this);
  private serverChannel: SecureSocket | null = null;
  private readonly queued: string[] = [];

  constructor(
    url: string,
    options: { lookup?: LookupFunction; family?: number; maxPayload?: number },
    mode: ServerMode = 'hive',
  ) {
    super();
    this.url = url;
    this.options = options;
    if (mode === 'old-server') {
      this.server.once('message', () =>
        this.server.send(
          JSON.stringify({
            kind: 'attach-refused',
            code: 'unauthorized',
            protocol: REMOTE_PROTOCOL_VERSION - 1,
            message: 'Malformed first frame.',
          } satisfies AttachRefused),
        ),
      );
    }
    if (mode === 'hive' || mode === 'unpaired') {
      const key = pskOfToken(mode === 'hive' ? CREDENTIAL.token : 'some other pairing');
      void respond(this.server, { pskFor: () => key }).then((outcome) => {
        if (outcome.kind !== 'secure') return;
        this.serverChannel = outcome.socket;
        outcome.socket.onMessage((text) => this.sent.push(text));
        for (const text of this.queued.splice(0)) outcome.socket.send(text);
      });
    }
  }

  send(data: Buffer | string): void {
    this.wire.push(data);
    this.server.emit('message', data, typeof data !== 'string');
  }

  close(): void {
    this.closeCalls += 1;
    this.emit('close');
  }

  /**
   * What the attach deadline calls (HIVE-144 review, I5) — modelled because
   * the deadline uses it rather than `close()`: a peer that has already shown
   * it may not answer is not asked to negotiate a graceful close.
   */
  terminate(): void {
    this.terminateCalls += 1;
    this.emit('close');
  }

  /** Delivers a server frame through the channel; held until the channel exists. */
  deliver(frame: unknown): void {
    this.deliverText(JSON.stringify(frame));
  }

  /** Delivers raw text through the channel, for a frame that is not JSON. */
  deliverText(text: string): void {
    if (this.serverChannel === null) this.queued.push(text);
    else this.serverChannel.send(text);
  }

  /** The attach frame this client sent, parsed. */
  attachFrame(): AttachRequest {
    return JSON.parse(this.sent[0]) as AttachRequest;
  }

  /** Every frame sent after the attach, parsed. */
  clientFrames(): (CallFrame | NotifyFrame)[] {
    return this.sent.slice(1).map((text) => JSON.parse(text) as CallFrame | NotifyFrame);
  }
}

/** Lets the handshake's promise reactions run: the hello, message 2, and the attach after it. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

interface Dial {
  promise: Promise<RemoteClient>;
  ctor: ReturnType<typeof vi.fn>;
  /** `null` only when the string fence refused before construction. */
  socket: FakeSocket | null;
}

/**
 * A direct dial's overrides, spelled as the host and port they name (HIVE-429 moved them under
 * `target`); `target` itself overrides both, for a relay dial.
 */
type DialOverrides = Partial<ConnectRemoteDeps> & { host?: string; port?: number };

/** Starts a connection against a {@link FakeSocket}, capturing the instance. */
function dial(overrides: DialOverrides = {}, mode: ServerMode = 'hive'): Dial {
  const { host = '127.0.0.1', port = 7433, ...rest } = overrides;
  let made: FakeSocket | null = null;
  // A `function`, not an arrow: vitest 4 refuses to let an arrow implementation
  // be called with `new`, and this mock stands in for a constructor.
  const ctor = vi.fn(function fakeCtor(url: string, options: Record<string, unknown>) {
    made = new FakeSocket(url, options, mode);
    return made;
  });

  const promise = connectRemote({
    target: { kind: 'direct', host, port },
    credential: CREDENTIAL,
    WebSocketCtor: ctor as unknown as typeof WebSocket,
    ...rest,
  });
  // Swallowed here only so a rejection a test asserts on later is not an
  // unhandled rejection in the meantime; every test still awaits `promise`.
  promise.catch(() => undefined);

  return { promise, ctor, socket: made };
}

/** Dials, completes the handshake, and returns the attached client. */
async function attachedClient(
  overrides: DialOverrides = {},
  frame: AttachAccepted = accepted(),
): Promise<{ client: RemoteClient; socket: FakeSocket }> {
  const { promise, socket } = dial(overrides);
  if (socket === null) throw new Error('the string fence refused before a socket was built');
  socket.emit('open');
  socket.deliver(frame);
  return { client: await promise, socket };
}

/** What the fenced `lookup` handed back to `net`. */
interface LookupResult {
  error: Error | null;
  resolved: unknown;
}

/** A resolver that always answers `address`, in whichever shape `net` asked for. */
function resolverAnswering(address: string): LookupFunction {
  return ((_hostname, options, callback) => {
    const all = (options as { all?: boolean }).all === true;
    if (all) (callback as unknown as (e: null, a: unknown) => void)(null, [{ address, family: 4 }]);
    else callback(null, address, 4);
  }) as LookupFunction;
}

const servers: WebSocketServer[] = [];
const clients: RemoteClient[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

/**
 * A real `ws` server on loopback that accepts every handshake, so the fence
 * tests differ only in what the resolver answers.
 */
async function realServer(): Promise<{ port: number; connections: () => number }> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  servers.push(server);
  let connections = 0;
  server.on('connection', (socket) => {
    connections += 1;
    void respond(socket, { pskFor: () => pskOfToken(CREDENTIAL.token) }).then((outcome) => {
      if (outcome.kind !== 'secure') return;
      outcome.socket.onMessage(() => outcome.socket.send(JSON.stringify(accepted())));
    });
  });
  await new Promise<void>((done) => server.on('listening', () => done()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { port: address.port, connections: () => connections };
}

describe('connectRemote — the string fence', () => {
  it('refuses a public address before connecting, pointing at the relay (HIVE-428)', async () => {
    const { promise, ctor } = dial({ host: '203.0.113.7' });

    // The point is that no socket is opened at all — asserted before the await,
    // so a fence that stopped running fails here rather than as a five-second
    // timeout on a promise nothing will ever settle.
    expect(ctor).not.toHaveBeenCalled();
    await expect(promise).rejects.toBeInstanceOf(AddressRefusedError);
  });

  /**
   * The pass arm of the same fence, varying only the host. Without it the test
   * above would still pass against a `connectRemote` that refused everything.
   */
  it('opens a socket to a loopback address', () => {
    const { ctor, socket } = dial({ host: '127.0.0.1' });

    expect(ctor).toHaveBeenCalledTimes(1);
    expect(socket?.url).toBe('ws://127.0.0.1:7433/');
  });

  /**
   * `100.63.255.255` is one address below the CGNAT range and
   * `100.64.0.1` is inside it — the arithmetic `TAILNET_V4` documents, read
   * back through the fence rather than through the predicate directly.
   */
  it('refuses an address one below the tailnet range and accepts the first one inside it', async () => {
    const below = dial({ host: '100.63.255.255' });
    await expect(below.promise).rejects.toBeInstanceOf(AddressRefusedError);
    expect(below.ctor).not.toHaveBeenCalled();

    const inside = dial({ host: '100.64.0.1' });
    expect(inside.ctor).toHaveBeenCalledTimes(1);
  });
});

describe('connectRemote — the resolved-address fence', () => {
  it('connects to a tailnet name whose DNS answer is inside the fence', async () => {
    const { port, connections } = await realServer();

    const client = await connectRemote({
      target: { kind: 'direct', host: 'mini.tail1234.ts.net', port },
      credential: CREDENTIAL,
      resolveAddress: resolverAnswering('127.0.0.1'),
    });
    clients.push(client);

    expect(client.serverName()).toBe('mini');
    expect(connections()).toBe(1);
  });

  it('refuses a tailnet name whose DNS answer is a public address', async () => {
    const { port, connections } = await realServer();

    const attempt = connectRemote({
      target: { kind: 'direct', host: 'mini.tail1234.ts.net', port },
      credential: CREDENTIAL,
      // The only difference from the test above. A hostile local resolver
      // answering a `.ts.net` name with its own address is the attack; the
      // host string is identical and no string-level predicate can see it.
      resolveAddress: resolverAnswering('203.0.113.7'),
    });

    await expect(attempt).rejects.toBeInstanceOf(AddressRefusedError);
    await expect(attempt).rejects.toThrow('203.0.113.7');
    expect(connections()).toBe(0);
  });

  /**
   * The tailnet half of the same fence, which the two arms above cannot show:
   * a test cannot stand a real server up on a `100.64.0.0/10` address, so the
   * `lookup` the client handed `ws` is invoked directly instead.
   */
  it('passes a CGNAT answer through and refuses a public one, on the lookup itself', () => {
    /** What the fence handed back for a resolver answering `address`. */
    const graded = (address: string, options: object = { family: 4 }): LookupResult => {
      const { socket } = dial({
        host: 'mini.tail1234.ts.net',
        resolveAddress: resolverAnswering(address),
      });
      const lookup = socket?.options.lookup;
      if (lookup === undefined) throw new Error('no lookup was handed to the socket');

      let result: LookupResult | null = null;
      lookup(
        'mini.tail1234.ts.net',
        options as Parameters<LookupFunction>[1],
        ((error: Error | null, resolved: unknown) => {
          result = { error, resolved };
        }) as unknown as Parameters<LookupFunction>[2],
      );
      if (result === null) throw new Error('the lookup never called back');
      return result;
    };

    expect(graded('100.64.0.5')).toEqual({ error: null, resolved: '100.64.0.5' });
    expect(graded('100.127.255.255')).toEqual({ error: null, resolved: '100.127.255.255' });

    const outside = graded('100.128.0.0');
    expect(outside.error).toBeInstanceOf(AddressRefusedError);
    expect(outside.error?.message).toContain('100.128.0.0');

    // The `all: true` shape `dns.lookup` uses when no family is pinned reaches
    // the same verdict, and is passed through as the array `net` asked for.
    expect(graded('100.64.0.5', { all: true })).toEqual({
      error: null,
      resolved: [{ address: '100.64.0.5', family: 4 }],
    });
    expect(graded('203.0.113.7', { all: true }).error).toBeInstanceOf(AddressRefusedError);
  });

  it('refuses a .local name whose answer is public, and passes one whose answer is on the LAN (HIVE-428)', () => {
    const graded = (address: string): LookupResult => {
      const { socket } = dial({ host: 'mini.local', resolveAddress: resolverAnswering(address) });
      const lookup = socket?.options.lookup;
      if (lookup === undefined) throw new Error('no lookup was handed to the socket');
      let result: LookupResult | null = null;
      lookup(
        'mini.local',
        { family: 4 } as Parameters<LookupFunction>[1],
        ((error: Error | null, resolved: unknown) => {
          result = { error, resolved };
        }) as unknown as Parameters<LookupFunction>[2],
      );
      if (result === null) throw new Error('the lookup never called back');
      return result;
    };

    expect(graded('192.168.1.20')).toEqual({ error: null, resolved: '192.168.1.20' });
    const publicAnswer = graded('8.8.8.8');
    expect(publicAnswer.error).not.toBeNull();
    expect(publicAnswer.error?.message).toContain('8.8.8.8');
  });

  /**
   * `resolveAddress` is an injectable dependency, so "the resolver answers
   * once" is a property of its caller, not of this file. Without the latch a
   * resolver that answered twice — refused, then good — would record the
   * refusal and then hand `net` the second answer anyway, and the connection
   * would proceed. `node:dns` does not do that; the fence does not get to
   * assume it.
   */
  it('answers net exactly once, even when the resolver calls back twice', () => {
    const twice: LookupFunction = ((_hostname, _options, callback) => {
      callback(null, '203.0.113.7', 4);
      callback(null, '127.0.0.1', 4);
    }) as LookupFunction;

    const { socket } = dial({ host: 'mini.tail1234.ts.net', resolveAddress: twice });
    const answers: LookupResult[] = [];
    socket?.options.lookup?.('mini.tail1234.ts.net', { family: 4 } as Parameters<LookupFunction>[1], ((
      error: Error | null,
      resolved: unknown,
    ) => {
      answers.push({ error, resolved });
    }) as unknown as Parameters<LookupFunction>[2]);

    expect(answers).toHaveLength(1);
    expect(answers[0].error).toBeInstanceOf(AddressRefusedError);
  });

  it('pins the lookup to IPv4 so every answer it grades is a dotted quad', () => {
    const { socket } = dial({ host: 'mini.tail1234.ts.net' });

    expect(socket?.options.family).toBe(4);
  });
});

describe('connectRemote — the handshake', () => {
  it('sends an attach frame carrying the credential and the protocol version', async () => {
    const { socket } = await attachedClient();

    expect(socket.attachFrame()).toEqual({
      kind: 'attach',
      protocol: REMOTE_PROTOCOL_VERSION,
      deviceId: 'd_9f2c',
      token: 's3cret',
    });
  });

  it('carries resumeFrom when it was given one, and omits it otherwise', async () => {
    const withResume = await attachedClient({ resumeFrom: { s1: { gen: 3, seq: 12 } } });
    expect(withResume.socket.attachFrame().resumeFrom).toEqual({ s1: { gen: 3, seq: 12 } });

    const without = await attachedClient();
    expect('resumeFrom' in without.socket.attachFrame()).toBe(false);
  });

  it('resolves with the snapshot the server accepted with', async () => {
    const snapshot: Partial<Record<Channel, unknown>> = {
      [CH.appInfo]: { version: '9.9.9' },
      [CH.configGet]: { projects: ['one', 'two'] },
    };
    const { client } = await attachedClient({}, accepted({ serverName: 'studio', snapshot }));

    expect(client.snapshot()).toEqual(snapshot);
    expect(client.serverName()).toBe('studio');
  });

  it('rejects with the refusal code on protocol-mismatch', async () => {
    const { promise, socket } = dial();
    socket?.emit('open');
    const refusal: AttachRefused = {
      kind: 'attach-refused',
      code: 'protocol-mismatch',
      protocol: 99,
      message: 'This server speaks protocol 99.',
    };
    socket?.deliver(refusal);

    await expect(promise).rejects.toBeInstanceOf(AttachRefusedError);
    await expect(promise).rejects.toMatchObject({ code: 'protocol-mismatch' });
    expect(socket?.closeCalls).toBe(1);
  });

  /**
   * The other three refusal codes reach the caller as themselves too — a
   * mismatch-only branch would pass the test above and lose `revoked`, which
   * is the one a settings pane must act on differently.
   */
  it('rejects with the refusal code on revoked', async () => {
    const { promise, socket } = dial();
    socket?.emit('open');
    socket?.deliver({
      kind: 'attach-refused',
      code: 'revoked',
      protocol: REMOTE_PROTOCOL_VERSION,
      message: 'This device has been revoked.',
    } satisfies AttachRefused);

    await expect(promise).rejects.toMatchObject({ code: 'revoked' });
  });
});

/**
 * The encrypted channel, from the client's side (HIVE-428). Every attach runs inside it, so what
 * matters here is how each way a handshake can end reaches the caller: an old server is named as
 * one, never as a credential problem; a server that does not know this pairing is a pairing
 * problem, which is terminal; anything else stays a transport failure worth dialling again.
 */
describe('connectRemote — the encrypted channel', () => {
  it('sends the hello as one binary frame, and the attach only inside the channel', async () => {
    const { socket } = await attachedClient();

    expect(Buffer.isBuffer(socket.wire[0])).toBe(true);
    expect((socket.wire[0] as Buffer).subarray(0, 4).toString('ascii')).toBe('HTC1');
    expect(socket.wire.every((frame) => Buffer.isBuffer(frame))).toBe(true);
    // The token never crosses in the clear: no raw frame contains it.
    expect(socket.wire.some((frame) => frame.includes(CREDENTIAL.token))).toBe(false);
    expect(socket.attachFrame().token).toBe(CREDENTIAL.token);
  });

  it('rejects with ServerTooOldError when the server answers the hello in text', async () => {
    const { promise, socket } = dial({}, 'old-server');
    socket?.emit('open');

    await expect(promise).rejects.toBeInstanceOf(ServerTooOldError);
    await expect(promise).rejects.toThrow(/older HiveTTY/);
    // Whatever the old server said, it is not read as a credential refusal.
    await expect(promise).rejects.not.toBeInstanceOf(AttachRefusedError);
    expect(socket?.closeCalls).toBe(1);
    expect(socket?.sent).toEqual([]);
  });

  it('rejects with PairingRefusedError when the server closes the handshake with 1008', async () => {
    const { promise, socket } = dial({}, 'unpaired');
    socket?.emit('open');

    await expect(promise).rejects.toBeInstanceOf(PairingRefusedError);
    await expect(promise).rejects.toThrow(/Pair again/);
    expect(socket?.sent).toEqual([]);
  });

  it('rejects with PairingRefusedError when message 2 does not verify, and closes with 1008', async () => {
    const { promise, socket } = dial({}, 'silent');
    const closes: unknown[] = [];
    if (socket === null) throw new Error('expected a socket');
    socket.close = () => {
      socket.closeCalls += 1;
      closes.push('closed');
      socket.emit('close', CHANNEL_CLOSE_CODE);
    };
    socket.emit('open');
    socket.emit('message', Buffer.alloc(48, 7), true);

    await expect(promise).rejects.toBeInstanceOf(PairingRefusedError);
    expect(socket.closeCalls).toBe(1);
  });

  it('treats a close mid-handshake with any other code as a transport drop, worth dialling again', async () => {
    const { promise, socket } = dial({}, 'silent');
    socket?.emit('open');
    socket?.emit('close', 1006);

    const cause = await promise.catch((error: unknown) => error);
    expect(cause).not.toBeInstanceOf(PairingRefusedError);
    expect(classifyCause(cause).kind).toBe('transport');
  });

  it('fails the attach, having sent nothing, for a stored device id over 255 bytes', async () => {
    const { promise, socket } = dial({ credential: { deviceId: 'd'.repeat(256), token: 's3cret' } });
    socket?.emit('open');

    await expect(promise).rejects.toThrow(/device id/);
    expect(socket?.wire).toEqual([]);
    expect(socket?.closeCalls).toBe(1);
  });

  it('sends no attach when message 2 arrives after its own deadline already failed the dial', async () => {
    vi.useFakeTimers();
    const { promise, socket } = dial({}, 'silent');
    if (socket === null) throw new Error('expected a socket');
    // Capture the hello a real responder would answer, but hold the answer.
    const server = new EventEmitter() as EventEmitter & { send(data: Buffer): void; close(): void; terminate(): void };
    let heldMessage2: Buffer | null = null;
    server.send = (data: Buffer) => {
      heldMessage2 = data;
    };
    server.close = () => undefined;
    server.terminate = () => undefined;
    void respond(server, { pskFor: () => pskOfToken(CREDENTIAL.token) });
    socket.emit('open');
    server.emit('message', socket.wire[0], true);
    socket.terminate = () => {
      socket.terminateCalls += 1;
    };

    await vi.advanceTimersByTimeAsync(CLIENT_ATTACH_TIMEOUT_MS);
    await expect(promise).rejects.toThrow(/did not complete the attach handshake/);

    expect(heldMessage2).not.toBeNull();
    socket.emit('message', heldMessage2, true);
    await settle();
    expect(socket.wire).toHaveLength(1);
  });

  it('classifies a refused pairing as terminal and unauthorized, and an old server as its own terminal cause', () => {
    expect(classifyCause(new PairingRefusedError('pair again'))).toEqual({
      kind: 'terminal',
      code: 'unauthorized',
      message: 'pair again',
    });
    expect(classifyCause(new ServerTooOldError('update'))).toEqual({
      kind: 'terminal',
      code: 'server-too-old',
      message: 'update',
    });
  });
});

/**
 * The client's own attach deadline (HIVE-144 review, I5).
 *
 * Nothing bounded this dial. `ClientOptions` carried `family`, `lookup` and
 * `maxPayload` and no timeout, and no timer was armed — the promise settled
 * only on a frame, an error or a close. The PR called the wait "bounded by the
 * handshake timeout", but that is the **server's**, and it only exists once
 * the far end is a Hive that answered: a tailnet host that is off costs the OS
 * TCP timeout, and one running some other TCP service on 7433 accepts and
 * never speaks HTTP, so the dial never returns. `switchIpcMode` awaits this
 * after `unbindEverything()`, so that whole wait is a window with no bound
 * channels.
 */
describe('connectRemote — the attach deadline', () => {
  /**
   * `ws`'s own option, covering TCP connect and the HTTP upgrade — the half a
   * timer on this side cannot see, because before the upgrade completes there
   * is no socket event to hang a deadline off that `ws` is not already
   * swallowing.
   */
  it('asks ws to bound the connect and upgrade', () => {
    const { ctor } = dial();

    expect(ctor).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ handshakeTimeout: CLIENT_ATTACH_TIMEOUT_MS }),
    );
  });

  /**
   * The half `handshakeTimeout` does not cover: a peer that completed the
   * WebSocket upgrade, took the attach frame, and never answered it. `ws` has
   * stopped watching by then.
   */
  it('gives up on a peer that upgrades and then never answers the attach', async () => {
    vi.useFakeTimers();
    const { promise, socket } = dial();
    socket?.emit('open');

    await vi.advanceTimersByTimeAsync(CLIENT_ATTACH_TIMEOUT_MS);

    await expect(promise).rejects.toThrow(/did not complete the attach handshake/);
    // Terminated, not closed: a graceful close is a frame this peer has
    // already shown it may not answer.
    expect(socket?.terminateCalls).toBe(1);
  });

  /**
   * The failure has to read as `connect-failed` in the pane, which is what
   * `outcomeFor` in `router.ts` makes of any non-`AddressRefusedError` — so
   * this must not be a `AddressRefusedError`, and it must carry a sentence
   * worth showing.
   */
  it('fails with an ordinary error naming the address and the budget', async () => {
    vi.useFakeTimers();
    const { promise, socket } = dial({ host: '100.64.1.2', port: 7433 });
    socket?.emit('open');

    await vi.advanceTimersByTimeAsync(CLIENT_ATTACH_TIMEOUT_MS);

    await expect(promise).rejects.not.toBeInstanceOf(AddressRefusedError);
    await expect(promise).rejects.toThrow(/100\.64\.1\.2:7433/);
    await expect(promise).rejects.toThrow(new RegExp(String(CLIENT_ATTACH_TIMEOUT_MS)));
  });

  /**
   * And it stops at the handshake. A live socket's idle time is
   * `CALL_GIVE_UP_MS`'s business, per call — a deadline left armed would
   * terminate a perfectly good connection ten seconds after it attached.
   */
  it('does not fire once the socket has attached', async () => {
    vi.useFakeTimers();
    const { promise, socket } = dial();
    socket?.emit('open');
    socket?.deliver(accepted());
    const client = await promise;

    await vi.advanceTimersByTimeAsync(CLIENT_ATTACH_TIMEOUT_MS * 3);

    expect(socket?.terminateCalls).toBe(0);
    expect(client.serverName()).toBe('mini');
  });
});

describe('connectRemote — calls', () => {
  it('correlates a result frame back to its call', async () => {
    const { client, socket } = await attachedClient();

    const first = client.call(CH.appInfo, { which: 'first' });
    const second = client.call(CH.configGet, { which: 'second' });
    const [frameOne, frameTwo] = socket.clientFrames() as CallFrame[];

    expect(frameOne.id).not.toBe(frameTwo.id);
    // Answered out of order, with different payloads, so a client that simply
    // resolved the oldest outstanding call would fail this.
    socket.deliver({ kind: 'result', id: frameTwo.id, payload: 'second answer' } satisfies ResultFrame);
    socket.deliver({ kind: 'result', id: frameOne.id, payload: 'first answer' } satisfies ResultFrame);

    await expect(first).resolves.toBe('first answer');
    await expect(second).resolves.toBe('second answer');
  });

  it('rejects a call whose error frame arrives, preserving the code', async () => {
    const { client, socket } = await attachedClient();

    const pending = client.call(CH.fsReadFile, { path: '/etc/passwd' });
    const [frame] = socket.clientFrames() as CallFrame[];
    socket.deliver({
      kind: 'error',
      id: frame.id,
      code: 'EOUTSIDE',
      message: 'That path is outside every project.',
    } satisfies ErrorFrame);

    await expect(pending).rejects.toBeInstanceOf(RemoteCallError);
    await expect(pending).rejects.toMatchObject({ code: 'EOUTSIDE' });
  });

  it('rejects a call that outruns CALL_GIVE_UP_MS', async () => {
    vi.useFakeTimers();
    const { client } = await attachedClient();

    const pending = client.call(CH.agentsRun, { name: 'slow' });
    const settled = vi.fn();
    pending.then(settled, settled);

    // The server answers its own timeout at CALL_DEADLINE_MS. Giving up at or
    // before that instant would abandon a call the server is still going to
    // answer, which is the race the two constants exist as a pair to close.
    await vi.advanceTimersByTimeAsync(CALL_DEADLINE_MS);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CALL_GIVE_UP_MS - CALL_DEADLINE_MS);
    await expect(pending).rejects.toMatchObject({ code: CALL_TIMEOUT_CODE });
  });

  /**
   * Counted at the instant the answer lands, **not** after advancing the clock
   * past the deadline (fix round). Advancing fires the timer and then reports
   * zero either way, so the first version of this assertion held whether or not
   * `clearTimeout` was ever called — a test that could not fail. What is
   * actually observable is a timer still armed one tick after the call settled.
   */
  it('clears the give-up timer when a result arrives', async () => {
    vi.useFakeTimers();
    const { client, socket } = await attachedClient();

    const pending = client.call(CH.appInfo, null);
    expect(vi.getTimerCount()).toBe(1);

    const [frame] = socket.clientFrames() as CallFrame[];
    socket.deliver({ kind: 'result', id: frame.id, payload: 'answered' } satisfies ResultFrame);

    expect(vi.getTimerCount()).toBe(0);
    await expect(pending).resolves.toBe('answered');
  });

  /** The sibling of the case above: the error branch settles a call too. */
  it('clears the give-up timer when an error frame arrives', async () => {
    vi.useFakeTimers();
    const { client, socket } = await attachedClient();

    const pending = client.call(CH.fsReadFile, { path: '/nope' });
    expect(vi.getTimerCount()).toBe(1);

    const [frame] = socket.clientFrames() as CallFrame[];
    socket.deliver({
      kind: 'error',
      id: frame.id,
      code: 'ENOENT',
      message: 'No such file.',
    } satisfies ErrorFrame);

    expect(vi.getTimerCount()).toBe(0);
    await expect(pending).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects every in-flight call when the socket closes', async () => {
    // Otherwise a detach leaves callers hanging forever.
    vi.useFakeTimers();
    const { client, socket } = await attachedClient();

    const first = client.call(CH.appInfo, null);
    const second = client.call(CH.configGet, null);
    expect(vi.getTimerCount()).toBe(2);

    socket.emit('close');

    await expect(first).rejects.toThrow(/closed/);
    await expect(second).rejects.toThrow(/closed/);
    // Each give-up timer goes with the call it was holding open. A rejection
    // that left the timers armed would fire two more times into an empty map.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a call made after the socket has closed', async () => {
    const { client, socket } = await attachedClient();
    socket.emit('close');

    await expect(client.call(CH.appInfo, null)).rejects.toThrow(/closed/);
  });
});

describe('connectRemote — the frame ceiling', () => {
  /** Comfortably past 8 MiB once inside a JSON string, and cheap to build. */
  const oversized = 'x'.repeat(POST_ATTACH_FRAME_MAX_BYTES + 1024);

  it('refuses to send a frame larger than POST_ATTACH_FRAME_MAX_BYTES', async () => {
    // 8 MiB, not 4. A larger frame is closed by the server rather than answered,
    // so bounding our own sends turns a dead socket into a rejected call.
    const { client, socket } = await attachedClient();

    const rejected = client.call(CH.fsWriteFile, { text: oversized });
    // Asserted before the await for the reason the string-fence test is: a
    // ceiling that stopped running sends the frame and hangs, and a timeout
    // says less than "it went out anyway" does.
    expect(socket.clientFrames()).toEqual([]);
    await expect(rejected).rejects.toMatchObject({ code: 'frame-too-large' });
  });

  /**
   * The sibling of the case above. A `notify` over the ceiling is refused by
   * the far end's `maxPayload` in exactly the same way — a 1009 close that
   * takes every unrelated in-flight correlation id with it — so bounding only
   * the kind that has a promise to reject would leave the cheaper-looking half
   * able to kill the connection. `pty:write` with a very large paste is how
   * that happens in practice.
   */
  it('refuses to send a notify frame larger than POST_ATTACH_FRAME_MAX_BYTES', async () => {
    const { client, socket } = await attachedClient();

    expect(() => client.notify(CH.ptyWrite, { id: 's1', data: oversized })).toThrow(
      /frame ceiling/,
    );
    expect(socket.clientFrames()).toEqual([]);
  });

  it('sends a frame that fits', async () => {
    const { client, socket } = await attachedClient();

    client.notify(CH.ptyWrite, { id: 's1', data: 'ls\n' });

    expect(socket.clientFrames()).toEqual([
      { kind: 'notify', channel: CH.ptyWrite, payload: { id: 's1', data: 'ls\n' } },
    ]);
  });

  it('asks ws for the same ceiling it enforces on its own sends', () => {
    const { socket } = dial();

    expect(socket?.options.maxPayload).toBe(POST_ATTACH_FRAME_MAX_BYTES + CHANNEL_TAG_BYTES);
  });

  /**
   * The sibling `sendBounded` cannot see (fix round). The attach frame is the
   * third client-sent frame and the only one with an unbounded shape —
   * `resumeFrom` is one `{ gen, seq }` per tracked session — and it is bounded
   * against the server's own, much smaller, handshake ceiling rather than the
   * post-attach one.
   */
  it('refuses to send an attach frame over the handshake ceiling, naming the real cause', async () => {
    const resumeFrom: Record<string, { gen: number; seq: number }> = {};
    // Roughly 40 bytes a session, so a few hundred clears 8 KiB.
    for (let index = 0; index < 500; index += 1) {
      resumeFrom[`session-${String(index)}`] = { gen: 2, seq: index };
    }

    const { promise, socket } = dial({ resumeFrom });
    socket?.emit('open');

    // Nothing went out: the socket is not spent proving what this side knew.
    expect(socket?.sent).toEqual([]);
    expect(socket?.closeCalls).toBe(1);
    await expect(promise).rejects.toBeInstanceOf(AttachFrameTooLargeError);
    // The message must not read as a credential problem, which is exactly what
    // the server's own `unauthorized` refusal would have looked like here.
    await expect(promise).rejects.toThrow(/500 sessions/);
    await expect(promise).rejects.toThrow(/not a credential problem/);
  });

  it('sends an attach frame that fits under the handshake ceiling', async () => {
    const resumeFrom: Record<string, { gen: number; seq: number }> = {};
    for (let index = 0; index < 20; index += 1) {
      resumeFrom[`session-${String(index)}`] = { gen: 2, seq: index };
    }

    const { socket } = await attachedClient({ resumeFrom });

    expect(Object.keys(socket.attachFrame().resumeFrom ?? {})).toHaveLength(20);
  });
});

describe('connectRemote — events', () => {
  it('routes an event frame to every onEvent listener', async () => {
    const { client, socket } = await attachedClient();
    const first = vi.fn();
    const second = vi.fn();
    const dropped = vi.fn();

    client.onEvent(first);
    client.onEvent(second);
    const unsubscribe = client.onEvent(dropped);
    unsubscribe();

    socket.deliver({
      kind: 'event',
      channel: CH.ptyData,
      payload: { id: 's1', chunk: 'hello' },
    } satisfies EventFrame);

    expect(first).toHaveBeenCalledWith(CH.ptyData, { id: 's1', chunk: 'hello' });
    expect(second).toHaveBeenCalledWith(CH.ptyData, { id: 's1', chunk: 'hello' });
    expect(dropped).not.toHaveBeenCalled();
  });

  /**
   * The mirror of `isClientFrameAllowed`'s direction half, pointed the other
   * way: a server pushing an `event` that names a `call` channel is sending
   * something no honest server sends, and a subscriber has no way to tell it
   * from a real push. Derived from `FRAME_KIND`, so it cannot drift from the
   * table the server grades against.
   */
  it('drops an event frame naming a channel that is not an event channel', async () => {
    const { client, socket } = await attachedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.deliver({ kind: 'event', channel: CH.configGet, payload: 'no' });
    socket.deliver({ kind: 'event', channel: 'not:a:channel', payload: 'no' });
    expect(listener).not.toHaveBeenCalled();

    socket.deliver({ kind: 'event', channel: CH.ptyData, payload: 'yes' } satisfies EventFrame);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  /**
   * The fan-out runs inside `ws`'s `'message'` emit, so an unguarded throw does
   * two things at once: it aborts the loop, losing the event for every listener
   * registered after the thrower, and it leaves the EventEmitter as an uncaught
   * exception in main. The throwing listener sits **between** two good ones so
   * the test can tell "the others still got it" from "the first one did".
   */
  it('keeps fanning out when a listener throws, and does not let the throw escape', async () => {
    const { client, socket } = await attachedClient();
    const before = vi.fn();
    const after = vi.fn();

    client.onEvent(before);
    client.onEvent(() => {
      throw new Error('a subscriber that cannot cope');
    });
    client.onEvent(after);

    expect(() => {
      socket.deliver({ kind: 'event', channel: CH.ptyData, payload: 'chunk' } satisfies EventFrame);
    }).not.toThrow();

    expect(before).toHaveBeenCalledWith(CH.ptyData, 'chunk');
    expect(after).toHaveBeenCalledWith(CH.ptyData, 'chunk');
  });

  it('survives a frame that is not JSON', async () => {
    const { client, socket } = await attachedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.deliverText('{not json');

    expect(listener).not.toHaveBeenCalled();
  });
});

/**
 * The replay that arrives in the accept's own tick (HIVE-150).
 *
 * The server sends `attach-accepted` and then, **synchronously, before its own
 * turn ends**, runs the resume replay into the same socket
 * (`remote-host/listener.ts`: `send(…'attach-accepted'…)` is followed directly
 * by `onAttach(socketHandle, request.resumeFrom)`). `ws` parses a chunk in a
 * synchronous loop and emits one `'message'` per frame with that stack still
 * live, so those frames can reach this client before anything has had a chance
 * to subscribe: `resolveConnection` only *queues a microtask*, and the caller
 * that eventually calls `onEvent` runs in it.
 *
 * Dropped, that is the whole feature failing silently — the replayed scrollback
 * never reaches the terminal, `recordArrival` never sees it so the tracker does
 * not advance, and the next reconnect asks from the same stale point again.
 *
 * This shape was harmless until HIVE-150: nothing before it depended on frames
 * arriving inside the accept's own tick.
 */
describe('frames that arrive before anyone has subscribed', () => {
  it('delivers a replay sent in the accept’s own tick to the first subscriber', async () => {
    const { promise, socket } = dial();
    if (socket === null) throw new Error('expected a socket');

    socket.emit('open');
    /*
      Both frames in one synchronous stretch, which is what the server does and
      what `ws` can hand over in a single parse of a single TCP segment.
    */
    socket.deliver(accepted());
    socket.deliver({
      kind: 'event',
      channel: CH.ptyData,
      payload: { sessionId: 's1', chunk: 'REPLAYED', gen: 2, seq: 41 },
    } satisfies EventFrame);

    const client = await promise;
    const seen: unknown[] = [];
    client.onEvent((channel, payload) => {
      seen.push({ channel, payload });
    });

    // Flushed to the first subscriber, not discarded for want of one.
    await Promise.resolve();
    expect(seen).toEqual([
      {
        channel: CH.ptyData,
        payload: { sessionId: 's1', chunk: 'REPLAYED', gen: 2, seq: 41 },
      },
    ]);
  });

  it('does not replay the buffer to a second subscriber', async () => {
    const { promise, socket } = dial();
    if (socket === null) throw new Error('expected a socket');

    socket.emit('open');
    socket.deliver(accepted());
    socket.deliver({
      kind: 'event',
      channel: CH.ptyData,
      payload: 'once',
    } satisfies EventFrame);

    const client = await promise;
    client.onEvent(() => undefined);
    const later: unknown[] = [];
    client.onEvent((_channel, payload) => {
      later.push(payload);
    });

    /*
      The buffer is a handover, not a log. A second subscriber joining later —
      the remote proxy re-registering across a rebind, say — must not be handed
      output the terminal has already rendered.
    */
    expect(later).toEqual([]);
  });

  it('bounds what it holds, so a server that never stops cannot grow it forever', async () => {
    const { promise, socket } = dial();
    if (socket === null) throw new Error('expected a socket');

    socket.emit('open');
    socket.deliver(accepted());
    for (let i = 0; i < PRE_SUBSCRIBE_BUFFER + 50; i += 1) {
      socket.deliver({ kind: 'event', channel: CH.ptyData, payload: i } satisfies EventFrame);
    }

    const client = await promise;
    const seen: unknown[] = [];
    client.onEvent((_channel, payload) => {
      seen.push(payload);
    });

    /*
      Bounded, and the *newest* kept: a client that has fallen this far behind
      before it even subscribed is going to take a gap notice anyway, and the
      recent frames are the ones its terminal still needs.
    */
    expect(seen).toHaveLength(PRE_SUBSCRIBE_BUFFER);
    expect(seen.at(-1)).toBe(PRE_SUBSCRIBE_BUFFER + 49);
  });
});

/**
 * The close signal (HIVE-150).
 *
 * HIVE-144 bounded the dial and rejected every pending call on a drop, but
 * nothing upstream could hear that a socket had died: `RemoteClient` exposed no
 * lifecycle at all, so `router.ts` kept `attached` pointing at a dead client and
 * the header chip kept naming a machine this window could no longer reach.
 * These cover the signal the reconnect loop listens on.
 */
describe('onClose', () => {
  it('fires once when an attached socket closes', async () => {
    const { client, socket } = await attachedClient();
    const heard = vi.fn();
    client.onClose(heard);

    socket.emit('close');

    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0]).toMatchObject({ kind: 'transport' });
  });

  it('fires once on an error, and not again on the close that follows it', async () => {
    const { client, socket } = await attachedClient();
    const heard = vi.fn();
    client.onClose(heard);

    /*
      `ws` emits both, in this order, for a connection that dies rather than one
      closed politely. A listener that heard it twice would start two reconnect
      loops against one drop, and the second would dial while the first was
      already waiting on its backoff.
    */
    socket.emit('error', new Error('ECONNRESET'));
    socket.emit('close');

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('hands its subscriber a client that is already fully shut', async () => {
    const { client, socket } = await attachedClient();

    const outstanding = client.call(CH.configGet, undefined);
    let refusedFromInside: unknown = null;
    client.onClose(() => {
      /*
        Started from inside the listener, so it can only be refused outright if
        the teardown finished before the announcement. That is the property
        worth pinning: the loop's first act on hearing a close is to dial again,
        and it must never do that against a client still holding callers.

        The rejection of `outstanding` cannot be observed *before* this listener
        instead — `promise.catch` is a microtask by specification and a listener
        is synchronous, so no correct implementation could make that ordering
        visible. What is visible is that both are settled by the time anyone can
        act, which is what this asserts from the two directions available.
      */
      client.call(CH.configGet, undefined).catch((cause: unknown) => {
        refusedFromInside = cause;
      });
    });

    socket.emit('close');

    await expect(outstanding).rejects.toThrow(/closed/);
    await Promise.resolve();
    expect(refusedFromInside).toBeInstanceOf(Error);
    expect(String(refusedFromInside)).toMatch(/is closed/);
  });

  it('stops delivering once unsubscribed', async () => {
    const { client, socket } = await attachedClient();
    const heard = vi.fn();
    const stop = client.onClose(heard);

    stop();
    socket.emit('close');

    expect(heard).not.toHaveBeenCalled();
  });

  it('refuses a notify on a dead socket instead of dropping it quietly', async () => {
    const { client, socket } = await attachedClient();
    socket.emit('close');

    /*
      The reconnect loop leaves this dead client bound for the whole backoff, so
      the terminal stays mounted and focused while the chip is amber. `pty:write`
      is `notify` kind, and this used to `return` — so every keystroke typed
      during the gap vanished before reaching the wire, and the reattach then
      replayed the server's transcript, which never contained them. Nothing
      anywhere recorded that the input had existed.

      The keystroke is lost either way; there is no socket. What this pins is
      that it is not lost *silently* — `remote-proxy.ts`'s notify wrapper logs
      what this throws.
    */
    expect(() => {
      client.notify(CH.ptyWrite, { sessionId: 's1', data: 'x' });
    }).toThrow(/is closed/);
  });
});

/**
 * What the reconnect loop branches on (HIVE-150).
 *
 * Exported rather than kept private because the loop classifies two different
 * things with it: the `CloseCause` a live socket hands `onClose`, and the
 * rejection a *failed dial* produces, which never reaches `onClose` at all
 * because there was no attached client to hear it. One table, both paths.
 */
describe('classifyCause', () => {
  it('names a refused resolution terminal rather than a transport drop', () => {
    /*
      Retrying this one would re-refuse on a timer forever while the pane
      claimed it was reconnecting — the address is wrong, and no amount of
      waiting changes an address.
    */
    expect(classifyCause(new AddressRefusedError('nope'))).toMatchObject({
      kind: 'terminal',
      code: 'address-refused',
    });
  });

  it('carries a server refusal through under its own code', () => {
    expect(classifyCause(new AttachRefusedError('unauthorized', 'no'))).toMatchObject({
      kind: 'terminal',
      code: 'unauthorized',
    });
    expect(classifyCause(new AttachRefusedError('revoked', 'no'))).toMatchObject({
      kind: 'terminal',
      code: 'revoked',
    });
    expect(classifyCause(new AttachRefusedError('protocol-mismatch', 'no'))).toMatchObject({
      kind: 'terminal',
      code: 'protocol-mismatch',
    });
  });

  it('names an oversized attach frame terminal', () => {
    /*
      The one terminal cause this side raises about itself. Dialling again sends
      the same oversized frame, so a retry is a loop that cannot converge.
    */
    expect(classifyCause(new AttachFrameTooLargeError('too big'))).toMatchObject({
      kind: 'terminal',
      code: 'attach-frame-too-large',
    });
  });

  it('treats anything else as worth retrying', () => {
    expect(classifyCause(new Error('ECONNREFUSED'))).toMatchObject({ kind: 'transport' });
    expect(classifyCause('not even an error')).toMatchObject({ kind: 'transport' });
  });
});

/**
 * A stand-in for the cloud relay on loopback (HIVE-429): a real `ws` server that records each
 * upgrade's path and authorization, then does whatever `onSocket` says with the socket. By default it
 * is the far Hive itself, which is what the relay hands bytes to: the channel and the attach run
 * through it unchanged.
 */
async function relayServer(
  onSocket?: (socket: WebSocket) => void,
  verifyClient?: ServerOptions['verifyClient'],
): Promise<{
  port: number;
  upgrades: { url: string | undefined; authorization: string | undefined }[];
  sockets: WebSocket[];
}> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', ...(verifyClient ? { verifyClient } : {}) });
  servers.push(server);
  const upgrades: { url: string | undefined; authorization: string | undefined }[] = [];
  const sockets: WebSocket[] = [];
  server.on('connection', (socket, request) => {
    upgrades.push({ url: request.url, authorization: request.headers.authorization });
    sockets.push(socket);
    if (onSocket !== undefined) {
      onSocket(socket);
      return;
    }
    void respond(socket, { pskFor: () => pskOfToken(CREDENTIAL.token) }).then((outcome) => {
      if (outcome.kind !== 'secure') return;
      outcome.socket.onMessage((text) => {
        const frame = JSON.parse(text) as { kind: string; id?: string };
        if (frame.kind === 'call') {
          outcome.socket.send(JSON.stringify({ kind: 'result', id: frame.id, payload: 'pong' }));
          return;
        }
        outcome.socket.send(JSON.stringify(accepted()));
      });
    });
  });
  await new Promise<void>((done) => server.on('listening', () => done()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { port: address.port, upgrades, sockets };
}

/** A ctor that records what it was handed and builds a real `ws` client from it. */
function recordingCtor(): {
  ctor: typeof WebSocket;
  made: { url: string; options: Record<string, unknown> }[];
} {
  const made: { url: string; options: Record<string, unknown> }[] = [];
  const ctor = function recording(url: string, options: Record<string, unknown>) {
    made.push({ url, options });
    return new WebSocket(url, options);
  } as unknown as typeof WebSocket;
  return { ctor, made };
}

const relayTarget = (port: number, overrides: object = {}): ConnectRemoteDeps['target'] => ({
  kind: 'relay',
  serverId: 'dev_1',
  cloudUrl: `http://127.0.0.1:${String(port)}`,
  accessToken: 'tok',
  ...overrides,
});

describe('connectRemote — a relay target (HIVE-429)', () => {
  it('dials the relay attach route with the bearer token and no address fence, and attaches through it', async () => {
    const { port, upgrades } = await relayServer();
    const { ctor, made } = recordingCtor();
    const resolveAddress = vi.fn() as unknown as LookupFunction;

    const client = await connectRemote({
      target: relayTarget(port),
      credential: CREDENTIAL,
      WebSocketCtor: ctor,
      resolveAddress,
    });
    clients.push(client);

    expect(made).toHaveLength(1);
    expect(made[0].url).toBe(`ws://127.0.0.1:${String(port)}/relay/attach/dev_1`);
    expect((made[0].options.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(made[0].options.lookup).toBeUndefined();
    expect(made[0].options.family).toBeUndefined();
    expect(made[0].options.maxPayload).toBe(POST_ATTACH_FRAME_MAX_BYTES + CHANNEL_TAG_BYTES);
    expect(made[0].options.handshakeTimeout).toBe(CLIENT_ATTACH_TIMEOUT_MS);
    expect(upgrades).toEqual([{ url: '/relay/attach/dev_1', authorization: 'Bearer tok' }]);
    expect(resolveAddress).not.toHaveBeenCalled();
    expect(client.serverName()).toBe('mini');
    await expect(client.call(CH.configGet, undefined)).resolves.toBe('pong');
  });

  it('never consults the resolver for a relay target', () => {
    const resolveAddress = vi.fn() as unknown as LookupFunction;
    const { socket } = dial({ target: relayTarget(7433), resolveAddress });

    expect(socket?.options.lookup).toBeUndefined();
    expect(resolveAddress).not.toHaveBeenCalled();
  });

  it('refuses a cloud base that is neither TLS nor loopback before any socket exists', async () => {
    const { promise, ctor } = dial({ target: relayTarget(0, { cloudUrl: 'http://example.com' }) });

    expect(ctor).not.toHaveBeenCalled();
    await expect(promise).rejects.toBeInstanceOf(RelayTargetError);
    expect(classifyCause(await promise.catch((cause: unknown) => cause))).toMatchObject({
      kind: 'terminal',
      code: 'relay-target',
    });
  });

  it('refuses a server id that is not a relay id before any socket exists', async () => {
    const { promise, ctor } = dial({ target: relayTarget(0, { serverId: 'a/b' }) });

    expect(ctor).not.toHaveBeenCalled();
    await expect(promise).rejects.toBeInstanceOf(RelayTargetError);
  });

  it.each([
    [4401, { kind: 'terminal', code: 'relay-sign-in' }],
    [4403, { kind: 'terminal', code: 'relay-locked' }],
    [4404, { kind: 'transport', code: 'relay-server-offline', message: RELAY_SERVER_OFFLINE }],
    [4408, { kind: 'transport', code: 'transport' }],
    [4429, { kind: 'transport', code: 'transport' }],
  ])('a %i close before the handshake is a RelayClosedError classified as listed', async (code, cause) => {
    const { port } = await relayServer((socket) => socket.close(code));

    const failure = await connectRemote({ target: relayTarget(port), credential: CREDENTIAL }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(RelayClosedError);
    expect((failure as RelayClosedError).code).toBe(code);
    expect(classifyCause(failure)).toMatchObject(cause);
  });

  it('tells onClose the server is offline when a live relay connection closes with 4404', async () => {
    const { port, sockets } = await relayServer();
    const client = await connectRemote({ target: relayTarget(port), credential: CREDENTIAL });
    clients.push(client);
    const heard = new Promise((done) => client.onClose(done));

    sockets[0].close(4404);

    expect(await heard).toEqual({
      kind: 'transport',
      code: 'relay-server-offline',
      message: RELAY_SERVER_OFFLINE,
    });
  });

  it('a live relay connection closed with 1001 is an ordinary drop', async () => {
    const { port, sockets } = await relayServer();
    const client = await connectRemote({ target: relayTarget(port), credential: CREDENTIAL });
    clients.push(client);
    const heard = new Promise((done) => client.onClose(done));

    sockets[0].close(1001);

    expect(await heard).toMatchObject({ kind: 'transport', code: 'transport' });
    expect(((await heard) as { message: string }).message).toContain('the server through the relay');
  });

  it('a 1008 during the handshake through the relay is still a refused pairing', async () => {
    const { port } = await relayServer((socket) => {
      socket.once('message', () => socket.close(CHANNEL_CLOSE_CODE));
    });

    await expect(
      connectRemote({ target: relayTarget(port), credential: CREDENTIAL }),
    ).rejects.toBeInstanceOf(PairingRefusedError);
  });

  it('an upgrade answered with HTTP 503 is a transport failure, retried', async () => {
    const { port } = await relayServer(undefined, (_info: unknown, callback: (verified: boolean, code?: number) => void) =>
      callback(false, 503),);

    const failure = await connectRemote({ target: relayTarget(port), credential: CREDENTIAL }).catch(
      (error: unknown) => error,
    );

    expect(failure).not.toBeInstanceOf(RelayClosedError);
    expect(classifyCause(failure)).toMatchObject({ kind: 'transport', code: 'transport' });
  });

  it('a direct target closed with 4404 is a plain transport error, not a relay verdict', async () => {
    const { promise, socket } = dial();
    socket?.emit('open');
    socket?.emit('close', 4404);

    const failure = await promise.catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(RelayClosedError);
    expect(classifyCause(failure)).toMatchObject({ kind: 'transport', code: 'transport' });
    expect(String(failure)).toContain('127.0.0.1:7433');
  });
});
