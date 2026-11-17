/**
 * The managed relay's wire contract (HIVE-429). The cloud keeps the same codes and paths in hivetty-cloud
 * `apps/api/src/module/relay/domain/relay-contract.ts`; change one side and the other must follow.
 */
export const RELAY_CLOSE = {
  goingAway: 1001,
  restarting: 1012,
  unauthorized: 4401,
  notEntitled: 4403,
  notFound: 4404,
  acceptTimeout: 4408,
  replaced: 4409,
  rateLimited: 4429,
} as const;

/** The relay pings every socket this often; a socket that goes silent for longer is dead. */
export const RELAY_PING_MS = 25_000;

/** The cloud's route pattern for a server id and a conn id. */
export const RELAY_ID = /^[A-Za-z0-9_-]{1,64}$/;

function id(value: string): string {
  // An id is interpolated into a path: one that could add a segment or a query is refused, never escaped.
  if (!RELAY_ID.test(value)) throw new Error('Not a relay id.');
  return value;
}

export const RELAY_PATH = {
  serve: '/relay/serve',
  hosts: '/relay/hosts',
  attach: (serverId: string): string => `/relay/attach/${id(serverId)}`,
  accept: (conn: string): string => `/relay/accept/${id(conn)}`,
} as const;

/** One row of `GET /relay/hosts`: a Mac of this person holding `/relay/serve` now. `since` is ISO. */
export interface RelayHost {
  serverId: string;
  name: string;
  since: string;
}

export type RelayHostsResult =
  | { ok: true; hosts: RelayHost[] }
  | { ok: false; reason: 'signed-out' | 'not-entitled' | 'unavailable' };

/** The serving side's relay state, as Settings shows it. Times are epoch ms. */
export interface RelayServeStatus {
  state: 'off' | 'pending-launch' | 'connecting' | 'connected' | 'reconnecting' | 'sign-in' | 'locked' | 'replaced';
  since?: number;
  nextAttemptAt?: number;
  reason?: string;
}

/** The only control frame: relay to serving Mac, on its serve socket. */
export const incomingFrame = (conn: string): string => JSON.stringify({ t: 'incoming', conn });

/** The conn id of an `incoming` frame, or `null` for anything else. */
export function parseIncoming(text: string): string | null {
  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof frame !== 'object' || frame === null) return null;
  const { t, conn } = frame as { t?: unknown; conn?: unknown };
  return t === 'incoming' && typeof conn === 'string' && RELAY_ID.test(conn) ? conn : null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The relay socket for `path`, on the cloud the app signs in to. The bearer token goes only to a URL this
 * built: TLS, or loopback for a self-hosted base and the test stub. Anything else throws.
 */
export function relaySocketUrl(cloudBase: string, path: string): string {
  let base: URL;
  try {
    base = new URL(cloudBase);
  } catch {
    throw new Error('The cloud address is not a URL.');
  }
  let scheme: string;
  if (base.protocol === 'https:') scheme = 'wss:';
  else if (base.protocol === 'http:' && LOOPBACK.has(base.hostname)) scheme = 'ws:';
  else throw new Error('The relay is reached only over TLS, or on loopback.');
  return `${scheme}//${base.host}${base.pathname.replace(/\/+$/, '')}${path}`;
}
