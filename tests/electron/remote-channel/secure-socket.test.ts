import { describe, expect, it } from 'vitest';

import {
  CHANNEL_CLOSE_CODE,
  type InitiateOutcome,
  type RawSocket,
  type RespondOutcome,
  type SecureSocket,
  initiate,
  pskOfToken,
  respond,
} from '../../../electron/remote-channel/secure-socket';

/**
 * The hello preamble and the secure socket over a WebSocket-shaped transport (HIVE-428).
 *
 * The fakes deliver `(data, isBinary)` the way `ws` does, and record every send, close code and
 * terminate, so "the server said nothing" is asserted, not assumed.
 */

type MessageListener = (data: unknown, isBinary: boolean) => void;

class FakeSocket implements RawSocket {
  peer: FakeSocket | null = null;
  readonly sent: { data: Buffer | string; isBinary: boolean }[] = [];
  readonly closes: (number | undefined)[] = [];
  terminated = 0;
  sendThrows = false;
  private readonly onListeners: MessageListener[] = [];
  private onceListeners: MessageListener[] = [];
  private closeListeners: (() => void)[] = [];

  send(data: Buffer | string): void {
    if (this.sendThrows) throw new Error('socket closed');
    const isBinary = typeof data !== 'string';
    this.sent.push({ data, isBinary });
    this.peer?.deliver(isBinary ? Buffer.from(data) : data, isBinary);
  }

  close(code?: number): void {
    this.closes.push(code);
    this.emitClose();
    this.peer?.emitClose();
  }

  terminate(): void {
    this.terminated += 1;
    this.emitClose();
  }

  on(_event: 'message', listener: MessageListener): this {
    this.onListeners.push(listener);
    return this;
  }

  once(event: 'message' | 'close', listener: MessageListener | (() => void)): this {
    if (event === 'message') this.onceListeners.push(listener as MessageListener);
    else this.closeListeners.push(listener as () => void);
    return this;
  }

  deliver(data: unknown, isBinary: boolean): void {
    // Like an EventEmitter, a listener added during this emit does not hear this frame.
    const persistent = [...this.onListeners];
    const once = this.onceListeners;
    this.onceListeners = [];
    for (const listener of once) listener(data, isBinary);
    for (const listener of persistent) listener(data, isBinary);
  }

  emitClose(): void {
    const listeners = this.closeListeners;
    this.closeListeners = [];
    for (const listener of listeners) listener();
  }
}

function pair(): { client: FakeSocket; server: FakeSocket } {
  const client = new FakeSocket();
  const server = new FakeSocket();
  client.peer = server;
  server.peer = client;
  return { client, server };
}

const TOKEN = 'device-token-of-mini';
const DEVICE = 'device-1';

async function connect(
  options: { pskFor?: (deviceId: string) => Buffer | null; deviceId?: string; psk?: Buffer } = {},
): Promise<{
  client: FakeSocket;
  server: FakeSocket;
  served: RespondOutcome;
  initiated: InitiateOutcome;
}> {
  const { client, server } = pair();
  const serving = respond(server, {
    pskFor: options.pskFor ?? ((id) => (id === DEVICE ? pskOfToken(TOKEN) : null)),
  });
  const initiated = await initiate(client, {
    deviceId: options.deviceId ?? DEVICE,
    psk: options.psk ?? pskOfToken(TOKEN),
  });
  return { client, server, served: await serving, initiated };
}

function secureOf(outcome: RespondOutcome | InitiateOutcome): SecureSocket {
  if (outcome.kind !== 'secure') throw new Error(`expected a secure outcome, got ${outcome.kind}`);
  return outcome.socket;
}

/** Sends a raw hello built by hand to a responding server, and returns what the server recorded. */
async function respondTo(hello: Buffer): Promise<{ server: FakeSocket; outcome: RespondOutcome }> {
  const server = new FakeSocket();
  const outcome = respond(server, { pskFor: () => pskOfToken(TOKEN) });
  server.deliver(hello, true);
  return { server, outcome: await outcome };
}

/** A well-formed hello from a real initiator, captured off the wire. */
function captureHello(deviceId = DEVICE): Buffer {
  const client = new FakeSocket();
  void initiate(client, { deviceId, psk: pskOfToken(TOKEN) });
  return Buffer.from(client.sent[0].data as Buffer);
}

describe('pskOfToken', () => {
  it('is the SHA-256 of the token, 32 bytes, the same every time', () => {
    expect(pskOfToken(TOKEN)).toHaveLength(32);
    expect(pskOfToken(TOKEN).equals(pskOfToken(TOKEN))).toBe(true);
    expect(pskOfToken(TOKEN).equals(pskOfToken('other'))).toBe(false);
  });
});

describe('a full handshake', () => {
  it('carries text intact each way, in binary frames only', async () => {
    const { client, server, served, initiated } = await connect();
    expect(served.kind).toBe('secure');
    if (served.kind === 'secure') expect(served.deviceId).toBe(DEVICE);
    const clientChannel = secureOf(initiated);
    const serverChannel = secureOf(served);

    const atServer: string[] = [];
    const atClient: string[] = [];
    serverChannel.onMessage((text) => atServer.push(text));
    clientChannel.onMessage((text) => atClient.push(text));

    clientChannel.send('{"kind":"attach"}');
    serverChannel.send('{"kind":"attach-accepted"} ✓');

    expect(atServer).toEqual(['{"kind":"attach"}']);
    expect(atClient).toEqual(['{"kind":"attach-accepted"} ✓']);
    expect(client.sent.every((frame) => frame.isBinary)).toBe(true);
    expect(server.sent.every((frame) => frame.isBinary)).toBe(true);
  });

  it('delivers frames that arrived before onMessage was set, in order, once it is', async () => {
    const { served, initiated } = await connect();
    const clientChannel = secureOf(initiated);
    clientChannel.send('one');
    clientChannel.send('two');
    const received: string[] = [];
    secureOf(served).onMessage((text) => received.push(text));
    clientChannel.send('three');
    expect(received).toEqual(['one', 'two', 'three']);
  });

  it('closes and handles WebSocket-shaped data: an ArrayBuffer and a fragment list', async () => {
    const { client, server, served, initiated } = await connect();
    const received: string[] = [];
    secureOf(served).onMessage((text) => received.push(text));
    const clientChannel = secureOf(initiated);
    // Encrypt through the client, then hand the server the same bytes in the other two shapes ws uses.
    client.peer = null;
    clientChannel.send('as-array-buffer');
    clientChannel.send('as-fragments');
    const [first, second] = client.sent.slice(-2).map((frame) => frame.data as Buffer);
    const copy = new Uint8Array(first.length);
    copy.set(first);
    server.deliver(copy.buffer, true);
    server.deliver([second.subarray(0, 5), second.subarray(5)], true);
    expect(received).toEqual(['as-array-buffer', 'as-fragments']);

    clientChannel.close(4000);
    expect(client.closes).toEqual([4000]);
    secureOf(served).terminate();
    expect(server.terminated).toBe(1);
  });
});

describe('respond refuses', () => {
  it('answers a text first frame with plaintext and sends nothing', async () => {
    const server = new FakeSocket();
    const outcome = respond(server, { pskFor: () => pskOfToken(TOKEN) });
    server.deliver('{"kind":"attach"}', false);
    expect(await outcome).toEqual({ kind: 'plaintext' });
    expect(server.sent).toEqual([]);
    expect(server.closes).toEqual([]);
  });

  it('treats an unknown device id and a wrong token identically: no frame, one close with 1008', async () => {
    const unknown = await connect({ pskFor: () => null });
    const wrong = await connect({ psk: pskOfToken('not the token') });
    for (const run of [unknown, wrong]) {
      expect(run.served).toEqual({ kind: 'refused' });
      expect(run.initiated).toEqual({ kind: 'refused' });
      expect(run.server.sent).toEqual([]);
      expect(run.server.closes).toEqual([CHANNEL_CLOSE_CODE]);
    }
  });

  it('treats a pskFor that throws like an unknown device', async () => {
    const run = await connect({
      pskFor: () => {
        throw new Error('config unreadable');
      },
    });
    expect(run.served).toEqual({ kind: 'refused' });
    expect(run.server.sent).toEqual([]);
    expect(run.server.closes).toEqual([CHANNEL_CLOSE_CODE]);
  });

  it.each([
    ['a wrong magic', (hello: Buffer) => Buffer.concat([Buffer.from('HTC2'), hello.subarray(4)])],
    ['a wrong version', (hello: Buffer) => Buffer.concat([hello.subarray(0, 4), Buffer.from([2]), hello.subarray(5)])],
    ['a zero id length', (hello: Buffer) => Buffer.concat([hello.subarray(0, 5), Buffer.from([0]), hello.subarray(6)])],
    ['one byte too long', (hello: Buffer) => Buffer.concat([hello, Buffer.from([0])])],
    ['one byte too short', (hello: Buffer) => hello.subarray(0, hello.length - 1)],
    ['shorter than its header', () => Buffer.from('HTC')],
    [
      'a tampered device id',
      (hello: Buffer) => {
        const tampered = Buffer.from(hello);
        tampered[6] ^= 1;
        return tampered;
      },
    ],
  ])('closes with 1008, having sent nothing, on a hello with %s', async (_name, mutate) => {
    const { server, outcome } = await respondTo(mutate(captureHello()));
    expect(outcome).toEqual({ kind: 'refused' });
    expect(server.sent).toEqual([]);
    expect(server.closes).toEqual([CHANNEL_CLOSE_CODE]);
  });

  it('is refused when its socket closes before any frame', async () => {
    const server = new FakeSocket();
    const outcome = respond(server, { pskFor: () => pskOfToken(TOKEN) });
    server.emitClose();
    expect(await outcome).toEqual({ kind: 'refused' });
  });

  it('is refused, not thrown, when sending message 2 throws', async () => {
    const server = new FakeSocket();
    server.sendThrows = true;
    const outcome = respond(server, { pskFor: () => pskOfToken(TOKEN) });
    server.deliver(captureHello(), true);
    expect(await outcome).toEqual({ kind: 'refused' });
    expect(server.closes).toEqual([CHANNEL_CLOSE_CODE]);
  });
});

describe('after the handshake', () => {
  it('closes with 1008 on a text frame and never calls the listener for it or anything after', async () => {
    const { server, served } = await connect();
    const received: string[] = [];
    secureOf(served).onMessage((text) => received.push(text));
    server.deliver('{"kind":"call"}', false);
    expect(server.closes).toEqual([CHANNEL_CLOSE_CODE]);
    expect(received).toEqual([]);
  });

  it('closes with 1008 on a replayed frame, and drops what follows', async () => {
    const { client, server, served, initiated } = await connect();
    const received: string[] = [];
    secureOf(served).onMessage((text) => received.push(text));
    const clientChannel = secureOf(initiated);
    clientChannel.send('once');
    const frame = client.sent[client.sent.length - 1].data as Buffer;
    server.deliver(Buffer.from(frame), true);
    expect(server.closes).toEqual([CHANNEL_CLOSE_CODE]);
    client.peer = null;
    clientChannel.send('after');
    server.deliver(Buffer.from(client.sent[client.sent.length - 1].data as Buffer), true);
    expect(received).toEqual(['once']);
  });
});

describe('initiate', () => {
  it('sends the hello as one binary frame of 6 + id + 48 bytes', () => {
    const hello = captureHello('mini');
    expect(hello.subarray(0, 4).toString('ascii')).toBe('HTC1');
    expect(hello[4]).toBe(1);
    expect(hello[5]).toBe(4);
    expect(hello.subarray(6, 10).toString('utf8')).toBe('mini');
    expect(hello).toHaveLength(6 + 4 + 48);
  });

  it('resolves plaintext with the text when the server answers in text', async () => {
    const client = new FakeSocket();
    const outcome = initiate(client, { deviceId: DEVICE, psk: pskOfToken(TOKEN) });
    client.deliver('{"kind":"attach-refused","code":"protocol-mismatch"}', false);
    expect(await outcome).toEqual({
      kind: 'plaintext',
      text: '{"kind":"attach-refused","code":"protocol-mismatch"}',
    });
  });

  it('resolves plaintext with the text when ws hands the text over as a Buffer', async () => {
    const client = new FakeSocket();
    const outcome = initiate(client, { deviceId: DEVICE, psk: pskOfToken(TOKEN) });
    client.deliver(Buffer.from('old server'), false);
    expect(await outcome).toEqual({ kind: 'plaintext', text: 'old server' });
  });

  it('resolves refused when the server closes without answering', async () => {
    const client = new FakeSocket();
    const outcome = initiate(client, { deviceId: DEVICE, psk: pskOfToken(TOKEN) });
    client.emitClose();
    expect(await outcome).toEqual({ kind: 'refused' });
  });

  it('closes with 1008 and resolves refused when message 2 does not verify', async () => {
    const client = new FakeSocket();
    const outcome = initiate(client, { deviceId: DEVICE, psk: pskOfToken(TOKEN) });
    client.deliver(Buffer.alloc(48, 9), true);
    expect(await outcome).toEqual({ kind: 'refused' });
    expect(client.closes).toEqual([CHANNEL_CLOSE_CODE]);
  });

  it.each([
    ['empty', ''],
    ['over 255 bytes', 'x'.repeat(256)],
  ])('rejects, having sent nothing, for a device id that is %s', async (_name, deviceId) => {
    const client = new FakeSocket();
    await expect(initiate(client, { deviceId, psk: pskOfToken(TOKEN) })).rejects.toThrow(/device id/);
    expect(client.sent).toEqual([]);
  });
});
