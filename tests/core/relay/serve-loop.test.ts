// @vitest-environment node
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as realWs from 'ws';
import type { WebSocket } from 'ws';

import { createRelayServe, SILENT_AFTER_MS, type RelayServeDeps } from '../../../core/relay/serve-loop';
import { CHANNEL_TAG_BYTES } from '../../../remote-channel/secure-socket';
import { RELAY_PATH, incomingFrame, type RelayServeStatus } from '../../../shared/relay-contract';
import { BACKOFF_MS, CLIENT_ATTACH_TIMEOUT_MS, POST_ATTACH_FRAME_MAX_BYTES } from '../../../shared/remote-contract';

vi.mock('ws', () => ({ WebSocket: vi.fn(function (this: object) { Object.assign(this, { on: vi.fn(), close: vi.fn() }); }) }));

interface FakeOptions {
  headers: { authorization: string };
  handshakeTimeout: number;
  maxPayload?: number;
  autoPong?: boolean;
}

let sockets: FakeSocket[] = [];

class FakeSocket extends EventEmitter {
  close = vi.fn();
  terminate = vi.fn();
  readonly url: string;
  readonly options: FakeOptions;
  constructor(url: string, options: FakeOptions) {
    super();
    this.url = url;
    this.options = options;
    sockets.push(this);
  }
}

const url = (path: string): string => `wss://relay.test${path}`;

function setup(overrides: Partial<RelayServeDeps> = {}) {
  let n = 0;
  const statuses: RelayServeStatus[] = [];
  const token = vi.fn(() => Promise.resolve<string | null>(`tok-${++n}`));
  const accept = vi.fn();
  const serve = createRelayServe({
    url,
    token,
    accept,
    onStatus: (status) => statuses.push(status),
    WebSocketCtor: FakeSocket as unknown as typeof WebSocket,
    now: () => Date.now(),
    ...overrides,
  });
  return { serve, statuses, token, accept, last: () => statuses.at(-1) };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

async function connected(overrides: Partial<RelayServeDeps> = {}) {
  const ctx = setup(overrides);
  ctx.serve.start();
  await flush();
  sockets[0]?.emit('open');
  return ctx;
}

async function acceptedSocket(conn = 'c1'): Promise<FakeSocket> {
  const before = sockets.length;
  sockets[0]?.emit('message', Buffer.from(incomingFrame(conn)), false);
  await flush();
  const socket = sockets[before];
  if (socket === undefined) throw new Error('no accept socket');
  socket.emit('open');
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
  sockets = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createRelayServe', () => {
  it('reports connecting and dials the serve URL with the bearer token and the handshake timeout', async () => {
    const { serve, statuses } = setup();
    serve.start();
    expect(statuses).toEqual([{ state: 'connecting' }]);
    await flush();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe(url(RELAY_PATH.serve));
    expect(sockets[0]?.options.headers.authorization).toBe('Bearer tok-1');
    expect(sockets[0]?.options.handshakeTimeout).toBe(CLIENT_ATTACH_TIMEOUT_MS);
    expect(sockets[0]?.options.autoPong).toBeUndefined();
    expect(sockets[0]?.options.maxPayload).toBeUndefined();
  });

  it('reports connected with since on open', async () => {
    const { last } = await connected();
    expect(last()).toEqual({ state: 'connected', since: Date.now() });
  });

  it('answers an incoming offer with an accept socket and hands it over in its open tick', async () => {
    const ctx = await connected();
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    await flush();

    const socket = sockets[1];
    expect(socket?.url).toBe(url(RELAY_PATH.accept('c1')));
    expect(socket?.options.headers.authorization).toBe('Bearer tok-2');
    expect(socket?.options.maxPayload).toBe(POST_ATTACH_FRAME_MAX_BYTES + CHANNEL_TAG_BYTES);
    expect(socket?.options.handshakeTimeout).toBe(CLIENT_ATTACH_TIMEOUT_MS);
    expect(socket?.options.autoPong).toBeUndefined();
    expect(ctx.accept).not.toHaveBeenCalled();

    socket?.emit('open');
    expect(ctx.accept).toHaveBeenCalledTimes(1);
    expect(ctx.accept).toHaveBeenCalledWith(socket);
  });

  it.each([
    ['a binary frame', Buffer.from(incomingFrame('c1')), true],
    ['junk', Buffer.from('junk'), false],
    ['a bad conn id', Buffer.from('{"t":"incoming","conn":"a/b"}'), false],
  ])('opens nothing for %s', async (_name, data, isBinary) => {
    const ctx = await connected();
    sockets[0]?.emit('message', data, isBinary);
    await flush();
    expect(sockets).toHaveLength(1);
    expect(ctx.token).toHaveBeenCalledTimes(1);
  });

  it('drops an accept socket that fails before open', async () => {
    const ctx = await connected();
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    await flush();
    expect(() => {
      sockets[1]?.emit('error', new Error('refused'));
      sockets[1]?.emit('close', 4404);
    }).not.toThrow();
    expect(ctx.accept).not.toHaveBeenCalled();
    ctx.serve.stop();
    expect(sockets[1]?.close).not.toHaveBeenCalled();
  });

  it('drops an offer when the accept token is null', async () => {
    let n = 0;
    const token = vi.fn(() => Promise.resolve(++n === 1 ? 'tok-1' : null));
    const ctx = await connected({ token });
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    await flush();
    expect(sockets).toHaveLength(1);
    expect(ctx.accept).not.toHaveBeenCalled();
  });

  it('drops an offer when the accept token rejects', async () => {
    let n = 0;
    const token = vi.fn(() => (++n === 1 ? Promise.resolve('tok-1') : Promise.reject(new Error('offline'))));
    await connected({ token });
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    await flush();
    expect(sockets).toHaveLength(1);
  });

  it('drops an offer when url throws for the accept path, and keeps serving', async () => {
    const throwing = (path: string): string => {
      if (path.startsWith('/relay/accept/')) throw new Error('refused');
      return url(path);
    };
    const ctx = await connected({ url: throwing });
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    await flush();
    expect(sockets).toHaveLength(1);
    expect(ctx.last()).toEqual({ state: 'connected', since: Date.now() });
  });

  it('retries on BACKOFF_MS, holds the last step, and resets on open', async () => {
    const { serve, last } = setup();
    serve.start();
    await flush();

    for (let i = 0; i < BACKOFF_MS.length + 2; i += 1) {
      const wait = BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)];
      sockets.at(-1)?.emit('close', 1012);
      expect(last()).toEqual({ state: 'reconnecting', nextAttemptAt: Date.now() + wait });
      const count = sockets.length;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(sockets).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(count + 1);
    }
    expect(BACKOFF_MS.at(-1)).toBe(30_000);

    sockets.at(-1)?.emit('open');
    sockets.at(-1)?.emit('close', 1012);
    expect(last()).toEqual({ state: 'reconnecting', nextAttemptAt: Date.now() + 1_000 });
  });

  it.each([
    [4401, 'sign-in'],
    [4403, 'locked'],
    [4409, 'replaced'],
  ] as const)('halts on %i with status %s and schedules nothing', async (code, state) => {
    const { last } = await connected();
    sockets[0]?.emit('close', code);
    expect(last()).toEqual({ state });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it.each([
    ['a drop', (_ctx: ReturnType<typeof setup>) => sockets[0]?.emit('close', 1012)],
    ['a halt', (_ctx: ReturnType<typeof setup>) => sockets[0]?.emit('close', 4401)],
    ['stop()', (ctx: ReturnType<typeof setup>) => ctx.serve.stop()],
    ['an error', (_ctx: ReturnType<typeof setup>) => sockets[0]?.emit('error', new Error('reset'))],
  ])('closes every accepted socket with 1001 on %s', async (_name, end) => {
    const ctx = await connected();
    const one = await acceptedSocket('c1');
    const two = await acceptedSocket('c2');
    end(ctx);
    expect(one.close).toHaveBeenCalledWith(1001);
    expect(two.close).toHaveBeenCalledWith(1001);
  });

  it('does not close an accepted socket that already closed', async () => {
    const ctx = await connected();
    const socket = await acceptedSocket();
    socket.emit('close', 1000);
    ctx.serve.stop();
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('treats a null token as a failed dial', async () => {
    const { serve, last } = setup({ token: () => Promise.resolve(null) });
    serve.start();
    await flush();
    expect(sockets).toHaveLength(0);
    expect(last()).toEqual({ state: 'reconnecting', nextAttemptAt: Date.now() + 1_000 });
  });

  it('treats a rejected token as a failed dial', async () => {
    const { serve, last } = setup({ token: () => Promise.reject(new Error('offline')) });
    serve.start();
    await flush();
    expect(sockets).toHaveLength(0);
    expect(last()?.state).toBe('reconnecting');
  });

  it('treats a throwing url as a failed dial', async () => {
    const { serve, last, token } = setup({
      url: () => {
        throw new Error('The relay is reached only over TLS, or on loopback.');
      },
    });
    serve.start();
    await flush();
    expect(sockets).toHaveLength(0);
    expect(token).toHaveBeenCalled();
    expect(last()).toEqual({ state: 'reconnecting', nextAttemptAt: Date.now() + 1_000 });
  });

  it('terminates a serve socket that hears no ping for SILENT_AFTER_MS', async () => {
    await connected();
    await vi.advanceTimersByTimeAsync(SILENT_AFTER_MS - 1);
    expect(sockets[0]?.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[0]?.terminate).toHaveBeenCalledTimes(1);
  });

  it('restarts the watchdog on every ping', async () => {
    await connected();
    await vi.advanceTimersByTimeAsync(SILENT_AFTER_MS / 2);
    sockets[0]?.emit('ping');
    await vi.advanceTimersByTimeAsync(SILENT_AFTER_MS - 1);
    expect(sockets[0]?.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[0]?.terminate).toHaveBeenCalledTimes(1);
  });

  it('waits for the relay’s two missed pings and a margin', () => {
    expect(SILENT_AFTER_MS).toBe(60_000);
  });

  it('ignores the old connection after stop(), and closes the serve socket 1000', async () => {
    const ctx = await connected();
    const count = ctx.statuses.length;
    ctx.serve.stop();
    expect(sockets[0]?.close).toHaveBeenCalledWith(1000);

    sockets[0]?.emit('open');
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    sockets[0]?.emit('ping');
    sockets[0]?.emit('close', 1012);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ctx.statuses).toHaveLength(count);
    expect(sockets).toHaveLength(1);
    expect(ctx.accept).not.toHaveBeenCalled();
    expect(sockets[0]?.terminate).not.toHaveBeenCalled();
  });

  it('closes an accept socket that opens after stop() instead of handing it over', async () => {
    const ctx = await connected();
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    await flush();
    ctx.serve.stop();
    sockets[1]?.emit('open');
    expect(ctx.accept).not.toHaveBeenCalled();
    expect(sockets[1]?.close).toHaveBeenCalledWith(1001);
  });

  it('builds no socket when stop() lands while the token is outstanding', async () => {
    const { serve } = setup();
    serve.start();
    serve.stop();
    await flush();
    expect(sockets).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending retry on stop()', async () => {
    const { serve } = setup({ token: () => Promise.resolve(null) });
    serve.start();
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    serve.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('schedules exactly one retry for an error followed by a close', async () => {
    const { serve, statuses } = setup();
    serve.start();
    await flush();
    sockets[0]?.emit('error', new Error('ECONNREFUSED'));
    sockets[0]?.emit('close', 1006);
    expect(statuses.filter((s) => s.state === 'reconnecting')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('starts afresh after a halt', async () => {
    const ctx = await connected();
    sockets[0]?.emit('close', 4409);
    ctx.serve.start();
    await flush();
    expect(sockets).toHaveLength(2);
    expect(ctx.last()).toEqual({ state: 'connecting' });
    sockets[1]?.emit('open');
    expect(ctx.last()?.state).toBe('connected');
  });

  it('uses ws’s WebSocket when no constructor is injected', async () => {
    const { serve } = setup({ WebSocketCtor: undefined });
    serve.start();
    await flush();
    expect(realWs.WebSocket).toHaveBeenCalledWith(url(RELAY_PATH.serve), {
      headers: { authorization: 'Bearer tok-1' },
      handshakeTimeout: CLIENT_ATTACH_TIMEOUT_MS,
    });
    serve.stop();
  });

  it('builds no accept socket for an offer whose serve connection dropped while its token was outstanding', async () => {
    const ctx = await connected();
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    sockets[0]?.emit('close', 1012);
    await flush();
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.url).toBe(url(RELAY_PATH.serve));
    expect(ctx.accept).not.toHaveBeenCalled();
  });

  it('closes, never hands over, an accept socket that opens after its serve connection dropped', async () => {
    const ctx = await connected();
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    await flush();
    sockets[0]?.emit('close', 1012);
    sockets[1]?.emit('open');
    expect(ctx.accept).not.toHaveBeenCalled();
    expect(sockets[1]?.close).toHaveBeenCalledWith(1001);
  });

  it('builds no accept socket for an offer outstanding across a halt', async () => {
    const ctx = await connected();
    sockets[0]?.emit('message', Buffer.from(incomingFrame('c1')), false);
    sockets[0]?.emit('close', 4401);
    await flush();
    expect(sockets).toHaveLength(1);
    expect(ctx.accept).not.toHaveBeenCalled();
  });

  it('ignores a late ping from a dropped connection', async () => {
    await connected();
    sockets[0]?.emit('close', 1012);
    sockets[0]?.emit('ping');
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1]?.emit('open');
    await vi.advanceTimersByTimeAsync(SILENT_AFTER_MS);
    expect(sockets[0]?.terminate).not.toHaveBeenCalled();
    expect(sockets[1]?.terminate).toHaveBeenCalledTimes(1);
  });
});
