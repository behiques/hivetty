import { WebSocket } from 'ws';

import { RELAY_CLOSE, RELAY_PATH, RELAY_PING_MS, parseIncoming, type RelayServeStatus } from '@shared/relay-contract';
import { POST_ATTACH_FRAME_MAX_BYTES } from '@shared/remote-contract';

import { CHANNEL_TAG_BYTES } from '../../remote-channel/secure-socket';
import { CLIENT_ATTACH_TIMEOUT_MS } from '../../remote-client/socket';
import { BACKOFF_MS } from '../ipc/reattach';

/** Two missed relay pings and a margin: past this a serve socket is half-open, whatever TCP says. */
export const SILENT_AFTER_MS = 2 * RELAY_PING_MS + 10_000;

/** The closes another dial would only repeat: the account, the plan, or a second install of this device. */
const HALT: Partial<Record<number, RelayServeStatus['state']>> = {
  [RELAY_CLOSE.unauthorized]: 'sign-in',
  [RELAY_CLOSE.notEntitled]: 'locked',
  [RELAY_CLOSE.replaced]: 'replaced',
};

export interface RelayServeDeps {
  /** `relaySocketUrl(cloudBase, path)`: the only way a relay URL is built. */
  url: (path: string) => string;
  /** A fresh access token, or `null` when signed out or offline. */
  token: () => Promise<string | null>;
  /** The listener's `acceptSocket(socket, { via: 'relay' })`. */
  accept: (socket: WebSocket) => void;
  onStatus: (status: RelayServeStatus) => void;
  /** Injectable purely so a unit test needs no socket. */
  WebSocketCtor?: typeof WebSocket;
  now?: () => number;
}

export interface RelayServe {
  start(): void;
  stop(): void;
}

/**
 * Holds the cloud's `/relay/serve` and answers each `incoming` offer with an accept socket (HIVE-429). The
 * listener does not track a relayed socket, so this owns every one it accepted and closes them itself.
 */
export function createRelayServe(deps: RelayServeDeps): RelayServe {
  const { url, token, accept, onStatus, WebSocketCtor = WebSocket, now = Date.now } = deps;

  const accepted = new Set<WebSocket>();
  /** Bumped by stop, start and every end of a serve connection, so a callback from an earlier one is stale. */
  let generation = 0;
  let attempt = 0;
  let serve: WebSocket | null = null;
  let retry: NodeJS.Timeout | null = null;
  let watchdog: NodeJS.Timeout | null = null;

  const stopWatchdog = (): void => {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
  };

  const dropAccepted = (): void => {
    for (const socket of accepted) socket.close(RELAY_CLOSE.goingAway);
    accepted.clear();
  };

  const teardown = (): void => {
    generation += 1;
    if (retry !== null) clearTimeout(retry);
    retry = null;
    stopWatchdog();
    serve?.close(1000);
    serve = null;
    dropAccepted();
  };

  /** Throws when `url` refuses the cloud base; both callers treat that as a failed attempt. */
  const open = (path: string, bearer: string, maxPayload?: number): WebSocket =>
    new WebSocketCtor(url(path), {
      headers: { authorization: `Bearer ${bearer}` },
      handshakeTimeout: CLIENT_ATTACH_TIMEOUT_MS,
      ...(maxPayload === undefined ? {} : { maxPayload }),
    });

  const schedule = (mine: number): void => {
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    onStatus({ state: 'reconnecting', nextAttemptAt: now() + wait });
    retry = setTimeout(() => {
      void connect(mine);
    }, wait);
  };

  const watch = (socket: WebSocket): void => {
    stopWatchdog();
    watchdog = setTimeout(() => {
      socket.terminate();
    }, SILENT_AFTER_MS);
  };

  const offer = async (conn: string, mine: number): Promise<void> => {
    // No token (signed out, or offline): the offer is left to time out at the relay (4408) and the client redials.
    const bearer = await token().catch(() => null);
    if (bearer === null || mine !== generation) return;
    let socket: WebSocket;
    try {
      socket = open(RELAY_PATH.accept(conn), bearer, POST_ATTACH_FRAME_MAX_BYTES + CHANNEL_TAG_BYTES);
    } catch {
      return;
    }
    // A failed accept is one lost offer, never the loop's failure.
    socket.on('error', () => undefined);
    socket.on('open', () => {
      if (mine !== generation) {
        socket.close(RELAY_CLOSE.goingAway);
        return;
      }
      accepted.add(socket);
      socket.on('close', () => accepted.delete(socket));
      // In this tick: the relay delivers the client's held hello as the very next message.
      accept(socket);
    });
  };

  const connect = async (mine: number): Promise<void> => {
    retry = null;
    const bearer = await token().catch(() => null);
    if (mine !== generation) return;
    let socket: WebSocket;
    try {
      if (bearer === null) throw new Error('no token');
      socket = open(RELAY_PATH.serve, bearer);
    } catch {
      schedule(mine);
      return;
    }
    serve = socket;

    let ended = false;
    /** Once per connection: `ws` emits `error` and then `close` for one failure. */
    const end = (code?: number): void => {
      if (ended || mine !== generation) return;
      ended = true;
      // Every end, not only a halt: an offer still waiting on its token belongs to this dead connection.
      generation += 1;
      serve = null;
      stopWatchdog();
      dropAccepted();
      const halted = code === undefined ? undefined : HALT[code];
      if (halted !== undefined) {
        onStatus({ state: halted });
        return;
      }
      schedule(generation);
    };

    socket.on('open', () => {
      if (mine !== generation) return;
      attempt = 0;
      onStatus({ state: 'connected', since: now() });
      watch(socket);
    });
    socket.on('ping', () => {
      if (mine === generation) watch(socket);
    });
    socket.on('message', (data, isBinary) => {
      if (mine !== generation || isBinary) return;
      const conn = parseIncoming(String(data));
      if (conn !== null) void offer(conn, mine);
    });
    socket.on('error', () => {
      end();
    });
    socket.on('close', (code: number) => {
      end(code);
    });
  };

  return {
    start() {
      teardown();
      attempt = 0;
      onStatus({ state: 'connecting' });
      void connect(generation);
    },
    stop() {
      teardown();
    },
  };
}
