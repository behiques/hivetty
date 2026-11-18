import type { AccountState } from '@shared/account-contract';
import { RELAY_ID, RELAY_PATH, type RelayHost, type RelayHostsResult } from '@shared/relay-contract';

const MAX_HOSTS = 16;
const MAX_NAME = 80;

/** One row of the cloud's answer, or nothing: the body is input from the network. */
function hostOf(row: unknown): RelayHost[] {
  if (typeof row !== 'object' || row === null) return [];
  const { serverId, name, since } = row as Record<string, unknown>;
  if (typeof serverId !== 'string' || !RELAY_ID.test(serverId)) return [];
  if (typeof name !== 'string' || typeof since !== 'string') return [];
  return [{ serverId, name: name.slice(0, MAX_NAME), since }];
}

/** `GET /relay/hosts` (HIVE-429): this person's Macs holding `/relay/serve` now. */
export async function readRelayHosts(
  authedFetch: (path: string) => Promise<Response>,
): Promise<RelayHostsResult> {
  let response: Response;
  try {
    response = await authedFetch(RELAY_PATH.hosts);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (response.status === 401) return { ok: false, reason: 'signed-out' };
  if (response.status === 403) return { ok: false, reason: 'not-entitled' };
  if (!response.ok) return { ok: false, reason: 'unavailable' };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!Array.isArray(body)) return { ok: false, reason: 'unavailable' };
  return { ok: true, hosts: body.flatMap(hostOf).slice(0, MAX_HOSTS) };
}

/** What the list needs of the signed-in cloud session; `licence/index.ts`'s `cloudSession()` satisfies it. */
interface HostsSession {
  account(): AccountState;
  authedFetch(path: string): Promise<Response>;
}

/**
 * `relay:hosts` (HIVE-429), answered by this process in either mode: the servers of the account signed in on
 * the machine the person is sitting at. Signed out is said without a request.
 */
export function relayHostsFor(session: HostsSession | null): Promise<RelayHostsResult> {
  if (session === null || session.account().kind !== 'signed-in') {
    return Promise.resolve({ ok: false, reason: 'signed-out' });
  }
  return readRelayHosts((path) => session.authedFetch(path));
}
