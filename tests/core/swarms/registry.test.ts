// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudError } from '../../../core/licence/cloud';
import { type AuthedFetch, cloneToken, readRegistry } from '../../../core/swarms/registry';

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hive-swarm-registry-test-'));
  file = join(root, 'swarms', 'registry.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const row = (id: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  slug: 'standard',
  kind: 'native',
  title: 'Standard',
  description: 'Ticket to merge.',
  publisher: 'HiveTTY',
  tags: ['workflow'],
  version: '1.0.0',
  updatedAt: '2026-11-19T00:00:00.000Z',
  installs: 3,
  agents: [{ name: 'builder', description: 'Builds.', tools: ['Bash'] }],
  skills: [{ name: 'tdd', description: 'Test first.' }],
  repoUrl: 'https://github.com/behiques/hivetty-swarms.git',
  folder: 'standard',
  commit: 'a'.repeat(40),
  access: 'token',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
  ...patch,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const fetchOf = (...answers: (Response | Error)[]) => {
  const fn = vi.fn<AuthedFetch>();
  for (const answer of answers) {
    if (answer instanceof Error) fn.mockRejectedValueOnce(answer);
    else fn.mockResolvedValueOnce(answer);
  }
  return fn;
};

const two = [row('cm1'), row('cm2', { slug: 'lean' })];

/** Fill the cache with the two rows through a real 200. */
const primed = async (): Promise<void> => {
  await readRegistry(fetchOf(json({ swarms: two }, 200, { etag: 'W/"a1"' })), file);
};

describe('readRegistry', () => {
  it('answers the good rows of a 200, drops a bad one, and caches them with the etag', async () => {
    const authedFetch = fetchOf(json({ swarms: [...two, row('cm3', { repoUrl: 'ext::sh' })] }, 200, { etag: 'W/"a1"' }));

    await expect(readRegistry(authedFetch, file)).resolves.toEqual({ swarms: two, source: 'cloud' });
    expect(authedFetch).toHaveBeenCalledWith('/api/swarms', undefined);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ etag: 'W/"a1"', swarms: two });
  });

  it('sends the etag back and answers the cache on a 304', async () => {
    await primed();
    const authedFetch = fetchOf(new Response(null, { status: 304 }));

    await expect(readRegistry(authedFetch, file)).resolves.toEqual({ swarms: two, source: 'cloud' });
    expect(authedFetch).toHaveBeenCalledWith('/api/swarms', { headers: { 'If-None-Match': 'W/"a1"' } });
  });

  it('answers the cache when the network fails', async () => {
    await primed();
    await expect(readRegistry(fetchOf(new CloudError('network')), file)).resolves.toEqual({
      swarms: two,
      source: 'cache',
    });
  });

  it('answers nothing when the network fails and there is no cache', async () => {
    await expect(readRegistry(fetchOf(new CloudError('network')), file)).resolves.toEqual({
      swarms: [],
      source: 'none',
    });
  });

  it.each<[string, () => Response]>([
    ['a 500', () => json({ error: 'boom' }, 500)],
    ['a 200 with no swarms', () => json({})],
    ['a 200 that is not JSON', () => new Response('<html>', { status: 200 })],
  ])('answers the cache on %s', async (_label, answer) => {
    await primed();
    await expect(readRegistry(fetchOf(answer()), file)).resolves.toEqual({ swarms: two, source: 'cache' });
  });

  it.each<[string, () => Response | Error]>([
    ['a refused session', () => new CloudError('refused', 'no access token')],
    ['a 401', () => json({ error: 'unauthorized' }, 401)],
    ['a 403', () => json({ error: 'forbidden' }, 403)],
  ])('answers nothing and deletes the cache on %s', async (_label, answer) => {
    await primed();
    await expect(readRegistry(fetchOf(answer()), file)).resolves.toEqual({ swarms: [], source: 'none' });
    expect(existsSync(file)).toBe(false);
  });

  it('answers nothing and keeps the cache when there is no cloud session yet', async () => {
    await primed();
    await expect(readRegistry(null, file)).resolves.toEqual({ swarms: [], source: 'none' });
    expect(existsSync(file)).toBe(true);
  });

  it('treats an unreadable cache as none and sends no etag', async () => {
    await primed();
    writeFileSync(file, 'not json');
    const authedFetch = fetchOf(new Response(null, { status: 304 }));

    await expect(readRegistry(authedFetch, file)).resolves.toEqual({ swarms: [], source: 'none' });
    expect(authedFetch).toHaveBeenCalledWith('/api/swarms', undefined);
  });

  it('checks the cached rows again when it reads them', async () => {
    await primed();
    writeFileSync(file, JSON.stringify({ etag: 'W/"a1"', swarms: [...two, row('cm3', { repoUrl: 'file:///tmp/x' })] }));

    await expect(readRegistry(fetchOf(new CloudError('network')), file)).resolves.toEqual({
      swarms: two,
      source: 'cache',
    });
  });
});

describe('cloneToken', () => {
  const repoUrl = 'https://github.com/behiques/hivetty-swarms.git';

  it('answers the token and the repository of a 200', async () => {
    const authedFetch = fetchOf(json({ token: 't', expiresAt: 'x', repoUrl }));

    await expect(cloneToken(authedFetch, 'cmabc')).resolves.toEqual({ token: 't', repoUrl });
    expect(authedFetch).toHaveBeenCalledWith('/api/swarms/cmabc/clone-token', { method: 'POST' });
  });

  it.each<[string, unknown]>([
    ['a repository off github.com', { token: 't', expiresAt: 'x', repoUrl: 'https://evil.example/x.git' }],
    ['no token', { expiresAt: 'x', repoUrl }],
  ])('refuses a 200 with %s', async (_label, body) => {
    await expect(cloneToken(fetchOf(json(body)), 'cmabc')).resolves.toEqual({
      code: 'failed',
      message: 'The cloud answered without a usable token.',
    });
  });

  const signIn = { code: 'unavailable', message: 'Sign in to install swarms.' };

  it('asks to sign in with no cloud session', async () => {
    await expect(cloneToken(null, 'cmabc')).resolves.toEqual(signIn);
  });

  it.each<[string, () => Response | Error]>([
    ['a refused session', () => new CloudError('refused', 'no access token')],
    ['a 401', () => json({ error: 'unauthorized' }, 401)],
  ])('asks to sign in on %s', async (_label, answer) => {
    await expect(cloneToken(fetchOf(answer()), 'cmabc')).resolves.toEqual(signIn);
  });

  it.each<[string, () => Response, string, string]>([
    [
      '403 no_licence',
      () => json({ error: 'no_licence' }, 403),
      'unavailable',
      'Installing swarms needs a HiveTTY Pro licence or trial.',
    ],
    ['404 not_found', () => json({ error: 'not_found' }, 404), 'unavailable', "This swarm isn't available to your account."],
    [
      '429 with ten minutes to wait',
      () => json({ error: 'rate_limited' }, 429, { 'retry-after': '600' }),
      'failed',
      'Too many installs. Try again in 10 minutes.',
    ],
    [
      '429 with thirty seconds to wait',
      () => json({ error: 'rate_limited' }, 429, { 'retry-after': '30' }),
      'failed',
      'Too many installs. Try again in 1 minute.',
    ],
    [
      '429 with a date to wait for',
      () => json({ error: 'rate_limited' }, 429, { 'retry-after': 'Wed, 19 Nov 2026 10:00:00 GMT' }),
      'failed',
      'Too many installs. Try again in 1 minute.',
    ],
    [
      '503 swarms_not_configured',
      () => json({ error: 'swarms_not_configured' }, 503),
      'failed',
      "This server isn't set up for HiveTTY's own swarms yet.",
    ],
    ['409 no_token_needed', () => json({ error: 'no_token_needed' }, 409), 'failed', 'The cloud refused the install (409).'],
  ])('maps %s', async (_label, answer, code, message) => {
    await expect(cloneToken(fetchOf(answer()), 'cmabc')).resolves.toEqual({ code, message });
  });

  it('reports a network failure as offline', async () => {
    await expect(cloneToken(fetchOf(new CloudError('network')), 'cmabc')).resolves.toEqual({
      code: 'offline',
      message: "HiveTTY Pro can't reach the cloud. Check your connection, then try again.",
    });
  });
});
