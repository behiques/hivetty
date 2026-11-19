/**
 * The cloud's swarm registry (HIVE-441 against HIVE-440's routes).
 *
 * `GET /api/swarms` with the last ETag, and the last answer kept on disk so
 * the list still renders offline. Every row is checked at this boundary and a
 * bad one is dropped. `POST /api/swarms/:id/clone-token` is asked on each
 * install; the token it answers is returned and kept nowhere.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { isSwarmRepoUrl, parseSwarmEntry, type SwarmEntry, type SwarmFailure } from '@shared/swarm-contract';

import { CloudError, stringField } from '../licence/cloud';

export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface RegistryRead {
  swarms: SwarmEntry[];
  source: 'cloud' | 'cache' | 'none';
}

interface Cache {
  etag: string | null;
  swarms: SwarmEntry[];
}

const rowsOf = (rows: unknown[]): SwarmEntry[] =>
  rows.map(parseSwarmEntry).filter((row): row is SwarmEntry => row !== null);

const refused = (cause: unknown): boolean => cause instanceof CloudError && cause.kind === 'refused';

async function readCache(file: string): Promise<Cache | null> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as { etag?: unknown; swarms?: unknown } | null;
    if (!Array.isArray(raw?.swarms)) return null;
    return { etag: typeof raw.etag === 'string' ? raw.etag : null, swarms: rowsOf(raw.swarms) };
  } catch {
    return null; // absent or unreadable: the next list refills it
  }
}

export async function readRegistry(authedFetch: AuthedFetch | null, file: string): Promise<RegistryRead> {
  // No session yet is not a sign-out: the cache stays for when there is one.
  if (authedFetch === null) return { swarms: [], source: 'none' };

  const cache = await readCache(file);
  const cached = (): RegistryRead =>
    cache === null ? { swarms: [], source: 'none' } : { swarms: cache.swarms, source: 'cache' };
  // The next account must not see this one's organization swarms.
  const signedOut = async (): Promise<RegistryRead> => {
    await rm(file, { force: true }).catch(() => undefined);
    return { swarms: [], source: 'none' };
  };

  let response: Response;
  try {
    response = await authedFetch('/api/swarms', cache?.etag ? { headers: { 'If-None-Match': cache.etag } } : undefined);
  } catch (cause) {
    return refused(cause) ? signedOut() : cached();
  }
  if (response.status === 304 && cache !== null) return { swarms: cache.swarms, source: 'cloud' };
  if (response.status === 401 || response.status === 403) return signedOut();
  if (!response.ok) return cached();

  const body: unknown = await response.json().catch(() => null);
  const rows = (body as { swarms?: unknown } | null)?.swarms;
  if (!Array.isArray(rows)) return cached();

  const swarms = rowsOf(rows);
  // A cache that cannot be written costs only the offline list.
  await mkdir(dirname(file), { recursive: true })
    .then(() => writeFile(file, `${JSON.stringify({ etag: response.headers.get('etag'), swarms })}\n`))
    .catch(() => undefined);
  return { swarms, source: 'cloud' };
}

const SIGN_IN: SwarmFailure = { code: 'unavailable', message: 'Sign in to install swarms.' };

export async function cloneToken(
  authedFetch: AuthedFetch | null,
  swarmId: string,
): Promise<{ token: string; repoUrl: string } | SwarmFailure> {
  if (authedFetch === null) return SIGN_IN;

  let response: Response;
  try {
    response = await authedFetch(`/api/swarms/${encodeURIComponent(swarmId)}/clone-token`, { method: 'POST' });
  } catch (cause) {
    if (refused(cause)) return SIGN_IN;
    return { code: 'offline', message: "HiveTTY Pro can't reach the cloud. Check your connection, then try again." };
  }
  const body: unknown = await response.json().catch(() => null);

  if (response.ok) {
    const token = stringField(body, 'token');
    const repoUrl = stringField(body, 'repoUrl');
    // The token reads one repository on github.com. It is never sent anywhere else.
    if (token && repoUrl && repoUrl.startsWith('https://github.com/') && isSwarmRepoUrl(repoUrl)) {
      return { token, repoUrl };
    }
    return { code: 'failed', message: 'The cloud answered without a usable token.' };
  }

  if (response.status === 401) return SIGN_IN;
  switch (stringField(body, 'error')) {
    case 'no_licence':
      return { code: 'unavailable', message: 'Installing swarms needs a HiveTTY Pro licence or trial.' };
    case 'not_found':
      return { code: 'unavailable', message: "This swarm isn't available to your account." };
    case 'rate_limited': {
      // Retry-After may also be an HTTP date; anything but seconds reads as a minute.
      const seconds = Number(response.headers.get('retry-after') ?? 0);
      const minutes = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 60)) : 1;
      return {
        code: 'failed',
        message: `Too many installs. Try again in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`,
      };
    }
    case 'swarms_not_configured':
      return { code: 'failed', message: "This server isn't set up for HiveTTY's own swarms yet." };
    default:
      return { code: 'failed', message: `The cloud refused the install (${String(response.status)}).` };
  }
}
