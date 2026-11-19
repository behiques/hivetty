// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudError } from '../../../core/licence/cloud';
import { applyMerge, conflictsSummary, CONFLICTS_DIR } from '../../../core/sync/apply';
import { collectFiles, decodeBundle, encodeBundle } from '../../../core/sync/bundle';
import { deriveKey, open, seal } from '../../../core/sync/crypto';
import {
  createSyncEngine,
  DEBOUNCE_MS,
  POLL_MS,
  SYNC_PATH,
  type EngineDeps,
  type SyncEngine,
} from '../../../core/sync/engine';
import type { MergeResult, View } from '../../../core/sync/merge';
import { createKeyStore, createStateStore, freshState, type StateStore } from '../../../core/sync/state';
import { NO_ENCRYPTION, WRONG_PASSPHRASE, type SyncStatus } from '../../../shared/sync-contract';

/**
 * The settings sync engine (HIVE-284), two Macs over a fake cloud that keeps the as-built `/api/sync`
 * contract in memory. Each case asserts the cloud's revision, both Macs' files or keys, and the status.
 */

const PASS = 'correct horse battery';
const cheap = (passphrase: string, salt: Buffer): Promise<Buffer> => deriveKey(passphrase, salt, 2 ** 10);

interface Blob {
  revision: number;
  salt: string;
  ciphertext: string;
}
interface Call {
  mac: string;
  method: string;
  headers: Record<string, string>;
  body?: { salt: string; ciphertext: string };
}

/** `/api/sync` as built (hivetty-cloud #53), in memory. */
function fakeCloud() {
  let blob: Blob | null = null;
  let counter = 0;
  const calls: Call[] = [];
  const forced: { method: string; response: () => Response }[] = [];
  let beforePut: (() => Promise<void>) | null = null;

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  async function handle(mac: string, path: string, init: RequestInit = {}): Promise<Response> {
    expect(path).toBe(SYNC_PATH);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Call['body']) : undefined;
    calls.push({ mac, method, headers, ...(body === undefined ? {} : { body }) });
    const force = forced.findIndex((entry) => entry.method === method);
    if (force >= 0) {
      const [entry] = forced.splice(force, 1);
      if (entry !== undefined) return entry.response();
    }
    if (method === 'PUT' && beforePut !== null) {
      const hook = beforePut;
      beforePut = null;
      await hook();
    }
    if (method === 'GET') {
      if (blob === null) return json({ error: 'not_found' }, 404);
      if (headers['if-none-match'] === `"${String(blob.revision)}"`) return new Response(null, { status: 304 });
      return json(blob, 200, { etag: `"${String(blob.revision)}"` });
    }
    if (method === 'DELETE') {
      blob = null;
      return new Response(null, { status: 204 });
    }
    const match = headers['if-match'];
    if (match === undefined) return json({ error: 'precondition_required' }, 428);
    const expected = blob === null ? 0 : blob.revision;
    if (match !== `"${String(expected)}"`) return json({ error: 'revision_mismatch', revision: blob?.revision ?? counter }, 412);
    if (blob !== null && body?.salt !== blob.salt) return json({ error: 'salt_mismatch' }, 409);
    counter += 1;
    blob = { revision: counter, salt: body?.salt ?? '', ciphertext: body?.ciphertext ?? '' };
    return json({ revision: counter });
  }

  return {
    calls,
    blob: () => blob,
    seed(next: Blob) {
      blob = next;
      counter = next.revision;
    },
    force(method: string, response: () => Response, times = 1) {
      for (let i = 0; i < times; i += 1) forced.push({ method, response });
    },
    reject(method: string) {
      forced.push({
        method,
        response: () => {
          throw new CloudError('network', 'offline');
        },
      });
    },
    beforeNextPut(hook: () => Promise<void>) {
      beforePut = hook;
    },
    fetchFor: (mac: string) => (path: string, init?: RequestInit) => handle(mac, path, init),
    json,
  };
}

type Cloud = ReturnType<typeof fakeCloud>;

const safeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(`enc:${Buffer.from(s).toString('hex')}`),
  decryptString: (b: Buffer) => Buffer.from(b.toString().slice(4), 'hex').toString(),
});

interface MacOptions {
  user?: string | null;
  encryption?: boolean;
  doc?: Record<string, unknown>;
  apply?: (real: EngineDeps['apply']) => EngineDeps['apply'];
  state?: (real: StateStore) => StateStore;
  start?: boolean;
}

const roots: string[] = [];
const engines: SyncEngine[] = [];

function makeMac(name: string, cloud: Cloud, options: MacOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), `sync-engine-${name}-`));
  roots.push(dir);
  const manifest = join(dir, '.seed.json');
  let doc: Record<string, unknown> = options.doc ?? {};
  let refuseConfig = false;
  let user: string | null = options.user === undefined ? 'usr_1' : options.user;
  const statuses: SyncStatus[] = [];
  const appearanceSent: unknown[] = [];
  const keys = createKeyStore({ file: join(dir, 'sync-key.bin'), safeStorage: safeStorage(options.encryption ?? true) });
  const realState = createStateStore(join(dir, 'sync-state.json'));
  const state = options.state?.(realState) ?? realState;
  const realApply: EngineDeps['apply'] = (result: MergeResult, kept: Record<string, string>) =>
    applyMerge(
      {
        hiveDir: dir,
        manifestFiles: [manifest],
        writeConfig: (mutate) => {
          if (refuseConfig) return false;
          doc = mutate(structuredClone(doc));
          return true;
        },
        resetShipped: () => Promise.reject(new Error('not shipped')),
        sendAppearance: (fields) => appearanceSent.push(fields),
        afterSkills: () => undefined,
        afterAgents: () => undefined,
        now: () => Date.now(),
      },
      result,
      kept,
    );
  const engine = createSyncEngine({
    fetch: cloud.fetchFor(name),
    userId: () => user,
    keys,
    state,
    readDocument: () => structuredClone(doc),
    collectFiles: () => collectFiles(dir, [manifest]),
    apply: options.apply?.(realApply) ?? realApply,
    conflicts: () => conflictsSummary(dir),
    deriveKey: cheap,
    now: () => Date.now(),
    onStatus: (status) => statuses.push(status),
  });
  engines.push(engine);
  if (options.start ?? true) engine.start();
  return {
    name,
    dir,
    engine,
    keys,
    state: realState,
    statuses,
    appearanceSent,
    get doc() {
      return doc;
    },
    set doc(next: Record<string, unknown>) {
      doc = next;
    },
    refuseConfig(on: boolean) {
      refuseConfig = on;
    },
    setUser(next: string | null) {
      user = next;
    },
    write(rel: string, text: string | Buffer, mtimeS?: number) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
      if (mtimeS !== undefined) utimesSync(full, mtimeS, mtimeS);
    },
    read(rel: string): string | null {
      const full = join(dir, rel);
      return existsSync(full) ? readFileSync(full, 'utf8') : null;
    },
    calls: () => cloud.calls.filter((call) => call.mac === name),
    status: () => engine.status(),
  };
}

type Mac = ReturnType<typeof makeMac>;

async function cloudView(cloud: Cloud, mac: Mac): Promise<View | null> {
  const key = mac.keys.read();
  const blob = cloud.blob();
  if (key === null || blob === null) return null;
  const plain = open(Buffer.from(key.key, 'base64'), key.userId, Buffer.from(blob.ciphertext, 'base64'));
  return plain === null ? null : decodeBundle(plain);
}

const problemOf = (status: SyncStatus): string | null => (status.kind === 'on' ? status.problem : `not on: ${status.kind}`);
const puts = (mac: Mac): Call[] => mac.calls().filter((call) => call.method === 'PUT');

let cloud: Cloud;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(Date.parse('2026-11-17T12:00:00Z'));
  cloud = fakeCloud();
});

afterEach(async () => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    await engine.idle();
  }
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function pair(): Promise<[Mac, Mac]> {
  const a = makeMac('A', cloud, { doc: { claudeCommand: 'claude' } });
  a.write('skills/mine/SKILL.md', 'mine');
  expect(await a.engine.setup(PASS)).toEqual({ ok: true });
  await a.engine.idle();
  const b = makeMac('B', cloud);
  expect(await b.engine.setup(PASS)).toEqual({ ok: true });
  await b.engine.idle();
  expect(b.doc).toEqual({ claudeCommand: 'claude' });
  return [a, b];
}

describe('setting up and joining', () => {
  it('1. the first Mac creates revision 1, and the blob holds nothing in clear', async () => {
    const a = makeMac('A', cloud, { doc: { claudeCommand: 'claude' } });
    expect(await a.engine.refresh()).toEqual({ kind: 'off', cloud: 'none', resetElsewhere: false });
    expect(await a.engine.setup(PASS)).toEqual({ ok: true });
    await a.engine.idle();
    expect(cloud.blob()?.revision).toBe(1);
    expect(Buffer.from(cloud.blob()?.ciphertext ?? '', 'base64').includes('claude')).toBe(false);
    expect(puts(a)[0]?.headers['if-match']).toBe('"0"');
    expect(a.status()).toMatchObject({ kind: 'on', problem: null, lastSyncedAt: Date.now() });
    expect(a.statuses.at(-1)).toEqual(a.status());
    expect(a.keys.read()?.userId).toBe('usr_1');
    expect(JSON.stringify(a.keys.read())).not.toContain(PASS);
  });

  it('2. a second Mac joins with the right passphrase and never with a wrong one', async () => {
    const a = makeMac('A', cloud, { doc: { claudeCommand: 'claude' } });
    a.write('skills/mine/SKILL.md', 'mine');
    await a.engine.setup(PASS);
    await a.engine.idle();
    const b = makeMac('B', cloud);
    expect(await b.engine.refresh()).toEqual({ kind: 'off', cloud: 'present', resetElsewhere: false });
    expect(await b.engine.setup('not the passphrase')).toEqual({ ok: false, error: WRONG_PASSPHRASE });
    expect(b.keys.read()).toBeNull();
    expect(b.state.read()).toBeNull();
    expect(await b.engine.setup(PASS)).toEqual({ ok: true });
    await b.engine.idle();
    expect(b.doc).toEqual({ claudeCommand: 'claude' });
    expect(b.read('skills/mine/SKILL.md')).toBe('mine');
    expect(b.status()).toMatchObject({ kind: 'on', problem: null });
    // The probe's answer was reused: the join downloaded the blob once.
    expect(b.calls().filter((call) => call.method === 'GET' && call.headers['if-none-match'] === undefined)).toHaveLength(1);
  });

  it('3. a short passphrase is refused on create and accepted on join', async () => {
    const a = makeMac('A', cloud);
    expect(await a.engine.setup('short')).toEqual({ ok: false, error: 'Use at least 12 characters.' });
    expect(a.keys.read()).toBeNull();
    const salt = Buffer.alloc(16, 3);
    const key = await cheap('short', salt);
    cloud.seed({ revision: 4, salt: salt.toString('base64'), ciphertext: seal(key, 'usr_1', await encodeBundle({})).toString('base64') });
    const b = makeMac('B', cloud);
    expect(await b.engine.setup('short')).toEqual({ ok: true });
  });

  it('refuses set-up without keychain encryption, and without a user', async () => {
    expect(await makeMac('A', cloud, { encryption: false }).engine.setup(PASS)).toEqual({ ok: false, error: NO_ENCRYPTION });
    expect(await makeMac('B', cloud, { user: null }).engine.setup(PASS)).toEqual({
      ok: false,
      error: 'Sign in to turn on sync.',
    });
    expect(cloud.calls).toEqual([]);
  });

  it('refuses set-up when the cloud cannot be reached', async () => {
    const a = makeMac('A', cloud);
    cloud.reject('GET');
    expect(await a.engine.setup(PASS)).toEqual({ ok: false, error: "Can't reach HiveTTY" });
    cloud.force('GET', () => cloud.json({ error: 'boom' }, 500));
    expect(await a.engine.setup(PASS)).toEqual({ ok: false, error: "Can't reach HiveTTY" });
    expect(a.keys.read()).toBeNull();
  });

  it('answers unavailable without keychain encryption', () => {
    expect(makeMac('A', cloud, { encryption: false }).status()).toEqual({ kind: 'unavailable', reason: 'no-encryption' });
  });

  it('8. on a first join the synced copy wins although this Mac’s is newer, and its copy is kept', async () => {
    const a = makeMac('A', cloud);
    a.write('skills/s/SKILL.md', 'from A', 1_000);
    await a.engine.setup(PASS);
    await a.engine.idle();
    const b = makeMac('B', cloud);
    b.write('skills/s/SKILL.md', 'from B', 9_000);
    await b.engine.setup(PASS);
    await b.engine.idle();
    expect(b.read('skills/s/SKILL.md')).toBe('from A');
    expect(b.status()).toMatchObject({ kind: 'on', conflicts: { count: 1, latest: { path: 'skills/s/SKILL.md' } } });
    const stamp = (b.status() as { conflicts: { latest: { at: number } } }).conflicts.latest.at;
    expect(b.read(`${CONFLICTS_DIR}/${new Date(stamp).toISOString().replaceAll(':', '-')}/skills/s/SKILL.md`)).toBe('from B');
  });
});

describe('cycles', () => {
  it('4. a change on A reaches B, and an unchanged B costs a 304', async () => {
    const [a, b] = await pair();
    a.doc = { claudeCommand: 'claude-beta' };
    await a.engine.now();
    await b.engine.now();
    expect(b.doc).toEqual({ claudeCommand: 'claude-beta' });
    const revision = cloud.blob()?.revision ?? 0;
    const before = b.calls().length;
    await b.engine.now();
    const last = b.calls().slice(before);
    expect(last).toEqual([{ mac: 'B', method: 'GET', headers: { 'if-none-match': `"${String(revision)}"` } }]);
  });

  it('5. both change different ids at once: B’s push loses the race, merges and pushes again', async () => {
    const [a, b] = await pair();
    const start = cloud.blob()?.revision ?? 0;
    cloud.beforeNextPut(async () => {
      a.doc = { claudeCommand: 'claude-a' };
      await a.engine.now();
    });
    b.write('skills/b/SKILL.md', 'from B');
    await b.engine.now();
    expect(puts(b).slice(-2).map((call) => call.headers['if-match'])).toEqual([`"${String(start)}"`, `"${String(start + 1)}"`]);
    await a.engine.now();
    expect(a.read('skills/b/SKILL.md')).toBe('from B');
    expect(b.doc).toEqual({ claudeCommand: 'claude-a' });
    expect(cloud.blob()?.revision).toBe(start + 2);
  });

  it('6. four 412s in a row end the run busy after exactly four PUTs', async () => {
    const [, b] = await pair();
    cloud.force('PUT', () => cloud.json({ error: 'revision_mismatch', revision: cloud.blob()?.revision }, 412), 4);
    b.write('skills/b/SKILL.md', 'from B');
    const before = puts(b).length;
    await b.engine.now();
    expect(puts(b).length - before).toBe(4);
    expect(problemOf(b.status())).toBe('busy');
  });

  it('7. both change the same file: the newer wins on both, and the loser is kept once', async () => {
    const [a, b] = await pair();
    a.write('skills/r/SKILL.md', 'base');
    await a.engine.now();
    await b.engine.now();
    expect(b.read('skills/r/SKILL.md')).toBe('base');
    a.write('skills/r/SKILL.md', 'A edit, newer', 9_000);
    b.write('skills/r/SKILL.md', 'B edit, older', 1_000);
    await b.engine.now(); // B pushes its edit
    cloud.reject('PUT'); // A merges, wins, keeps B's copy, then cannot push
    await a.engine.now();
    expect(problemOf(a.status())).toBe('offline');
    await a.engine.now(); // the same merge again: the copy is not made twice
    await b.engine.now();
    expect(a.read('skills/r/SKILL.md')).toBe('A edit, newer');
    expect(b.read('skills/r/SKILL.md')).toBe('A edit, newer');
    expect(a.status()).toMatchObject({ kind: 'on', problem: null, conflicts: { count: 1 } });
    expect(b.status()).toMatchObject({ conflicts: { count: 0 } });
  });

  it('9. a group switched off on B neither takes nor sends, and is carried through byte-equal', async () => {
    const [a, b] = await pair();
    await b.engine.setGroup('harnesses', false);
    expect(b.status()).toMatchObject({ groups: { harnesses: false, automation: true, workspace: true } });
    a.doc = { claudeCommand: 'claude-a' };
    await a.engine.now();
    const harnessesOf = (view: View | null) =>
      Object.fromEntries(Object.entries(view ?? {}).filter(([id]) => id.startsWith('harnesses:')));
    const written = harnessesOf(await cloudView(cloud, a));
    await b.engine.now();
    expect(b.doc).toEqual({ claudeCommand: 'claude' });
    b.doc = { claudeCommand: 'claude', clis: { codex: { command: 'codex-b' } } };
    b.write('skills/b/SKILL.md', 'from B');
    await b.engine.now();
    const after = await cloudView(cloud, a);
    expect(after?.['automation:f:skills/b/SKILL.md']).toBeDefined();
    expect(harnessesOf(after)).toEqual(written);
  });

  it('10. appearance is carried through until this Mac reports it, then merges', async () => {
    const [a, b] = await pair();
    a.engine.reportAppearance({ density: 'compact' });
    await a.engine.now();
    b.write('skills/b/SKILL.md', 'from B');
    await b.engine.now();
    expect(b.appearanceSent).toEqual([]);
    expect((await cloudView(cloud, a))?.['workspace:k:appearance.density']?.data).toBe('compact');
    b.engine.reportAppearance({ theme: 'dark' });
    await b.engine.now();
    expect(b.appearanceSent).toEqual([{ density: 'compact' }]);
    expect((await cloudView(cloud, a))?.['workspace:k:appearance.theme']?.data).toBe('dark');
  });

  it('20. a refused config write shows apply-failed, and the next run applies it', async () => {
    const [a, b] = await pair();
    a.doc = { claudeCommand: 'claude-a' };
    await a.engine.now();
    b.refuseConfig(true);
    await b.engine.now();
    expect(problemOf(b.status())).toBe('apply-failed');
    expect(b.doc).toEqual({ claudeCommand: 'claude' });
    b.refuseConfig(false);
    await b.engine.now();
    expect(problemOf(b.status())).toBeNull();
    expect(b.doc).toEqual({ claudeCommand: 'claude-a' });
  });
});

describe('reset and refusals', () => {
  it('11. a reset on A turns B off with the notice, and both can start again', async () => {
    const [a, b] = await pair();
    expect(await a.engine.reset()).toEqual({ ok: true });
    expect(a.status()).toEqual({ kind: 'off', cloud: 'none', resetElsewhere: false });
    await b.engine.now();
    expect(b.status()).toEqual({ kind: 'off', cloud: 'none', resetElsewhere: true });
    expect(b.keys.read()).toBeNull();
    expect(b.read('skills/mine/SKILL.md')).toBe('mine');
    expect(await a.engine.setup('a brand new passphrase')).toEqual({ ok: true });
    await a.engine.idle();
    expect(await b.engine.setup('a brand new passphrase')).toEqual({ ok: true });
    await b.engine.idle();
    expect(b.status()).toMatchObject({ kind: 'on' });
  });

  it('a reset the cloud refuses changes nothing here', async () => {
    const [a] = await pair();
    cloud.force('DELETE', () => cloud.json({ error: 'boom' }, 500));
    expect(await a.engine.reset()).toEqual({ ok: false, error: "Couldn't reset sync. Try again." });
    cloud.reject('DELETE');
    expect(await a.engine.reset()).toEqual({ ok: false, error: "Couldn't reset sync. Try again." });
    expect(a.status()).toMatchObject({ kind: 'on' });
  });

  it('12. a 409 is the same reset-elsewhere, with the cloud present', async () => {
    const [, b] = await pair();
    cloud.force('PUT', () => cloud.json({ error: 'salt_mismatch' }, 409));
    b.write('skills/b/SKILL.md', 'from B');
    await b.engine.now();
    expect(b.status()).toEqual({ kind: 'off', cloud: 'present', resetElsewhere: true });
    expect(b.keys.read()).toBeNull();
  });

  it('a blob this key cannot open, or another salt, is a reset elsewhere', async () => {
    const [a, b] = await pair();
    const blob = cloud.blob();
    cloud.seed({ revision: (blob?.revision ?? 0) + 1, salt: blob?.salt ?? '', ciphertext: Buffer.alloc(40).toString('base64') });
    await b.engine.now();
    expect(b.status()).toEqual({ kind: 'off', cloud: 'present', resetElsewhere: true });
    cloud.seed({ revision: (blob?.revision ?? 0) + 2, salt: Buffer.alloc(16, 9).toString('base64'), ciphertext: blob?.ciphertext ?? '' });
    await a.engine.now();
    expect(a.status()).toEqual({ kind: 'off', cloud: 'present', resetElsewhere: true });
  });

  it('13. a 403 locks, and nothing more is sent', async () => {
    const [a] = await pair();
    cloud.force('GET', () => cloud.json({ error: 'not_entitled' }, 403));
    await a.engine.now();
    expect(a.status()).toEqual({ kind: 'unavailable', reason: 'locked' });
    const before = a.calls().length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    a.engine.changed();
    await a.engine.now();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await a.engine.idle();
    expect(a.calls().length).toBe(before);
  });

  it('14. a 429 waits Retry-After seconds, then runs once', async () => {
    const [a] = await pair();
    cloud.force('PUT', () => cloud.json({ error: 'rate_limited' }, 429, { 'retry-after': '7' }));
    a.write('skills/a/SKILL.md', 'more');
    await a.engine.now();
    expect(problemOf(a.status())).toBeNull();
    const before = cloud.calls.length;
    await a.engine.now(); // a trigger inside the wait sends nothing
    await vi.advanceTimersByTimeAsync(6_999);
    expect(cloud.calls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    await a.engine.idle();
    expect(cloud.calls.length).toBeGreaterThan(before);
    expect(cloud.calls.at(-1)?.method).toBe('PUT');
  });

  it('a 429 without Retry-After waits a minute', async () => {
    const [a] = await pair();
    cloud.force('PUT', () => cloud.json({ error: 'rate_limited' }, 429));
    a.write('skills/a/SKILL.md', 'more');
    await a.engine.now();
    const before = cloud.calls.length;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(cloud.calls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    await a.engine.idle();
    expect(cloud.calls.length).toBeGreaterThan(before);
  });

  it('15. a view that seals over 5 MB is too large and is not sent', async () => {
    const [a] = await pair();
    a.write('skills/big/blob.bin', randomBytes(6 * 1024 * 1024));
    const before = puts(a).length;
    await a.engine.now();
    expect(problemOf(a.status())).toBe('too-large');
    expect(puts(a).length).toBe(before);
  });

  it('a 413 is too large', async () => {
    const [a] = await pair();
    cloud.force('PUT', () => cloud.json({ error: 'too_large' }, 413));
    a.write('skills/a/SKILL.md', 'more');
    await a.engine.now();
    expect(problemOf(a.status())).toBe('too-large');
  });

  it('16. a fetch that rejects is offline, and the last synced time stays', async () => {
    const [a] = await pair();
    const synced = (a.status() as { lastSyncedAt: number }).lastSyncedAt;
    vi.advanceTimersByTime(60_000);
    cloud.reject('GET');
    await a.engine.now();
    expect(a.status()).toMatchObject({ kind: 'on', problem: 'offline', lastSyncedAt: synced });
    cloud.force('GET', () => cloud.json({ error: 'boom' }, 502));
    await a.engine.now();
    expect(problemOf(a.status())).toBe('offline');
  });

  it('a pull that is not JSON is offline, not a reset', async () => {
    const [a] = await pair();
    cloud.force('GET', () => new Response('<html>', { status: 200 }));
    await a.engine.now();
    expect(problemOf(a.status())).toBe('offline');
    expect(a.keys.read()).not.toBeNull();
  });
});

describe('timers and triggers', () => {
  it('17. three changes within 5 s cause one run 5 s after the last; the poll runs at 5 minutes; stop ends both', async () => {
    const [a] = await pair();
    const gets = () => a.calls().filter((call) => call.method === 'GET').length;
    const start = gets();
    a.engine.changed();
    await vi.advanceTimersByTimeAsync(2_000);
    a.engine.changed();
    await vi.advanceTimersByTimeAsync(2_000);
    a.engine.changed();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(gets()).toBe(start);
    await vi.advanceTimersByTimeAsync(1);
    expect(gets()).toBe(start + 1);
    await a.engine.idle();
    await vi.advanceTimersByTimeAsync(POLL_MS - 9_000 - 1);
    expect(gets()).toBe(start + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(gets()).toBe(start + 2);
    await a.engine.idle();
    a.engine.stop();
    a.engine.changed();
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(gets()).toBe(start + 2);
  });

  it('18. a trigger during a run causes exactly one more run', async () => {
    const [a] = await pair();
    const gets = () => a.calls().filter((call) => call.method === 'GET').length;
    const start = gets();
    const first = a.engine.now();
    void a.engine.now();
    void a.engine.now();
    await first;
    await a.engine.idle();
    expect(gets()).toBe(start + 2);
  });

  it('start runs once when a key is stored, and not otherwise', async () => {
    const [a] = await pair();
    a.engine.stop();
    const before = cloud.calls.length;
    a.engine.start();
    await a.engine.idle();
    expect(cloud.calls.length).toBe(before + 1);
    makeMac('C', cloud);
    expect(cloud.calls.length).toBe(before + 1);
  });

  it('19. stop with wipe deletes the key and the state and leaves the conflicts folder', async () => {
    const [a] = await pair();
    a.write(`${CONFLICTS_DIR}/2026-11-17T12-00-00.000Z/skills/x/SKILL.md`, 'kept');
    a.engine.stop({ wipe: true });
    expect(a.keys.read()).toBeNull();
    expect(a.state.read()).toBeNull();
    expect(a.read(`${CONFLICTS_DIR}/2026-11-17T12-00-00.000Z/skills/x/SKILL.md`)).toBe('kept');
  });

  it('21. a key stored for another user is deleted at start and never used', async () => {
    const c = makeMac('C', cloud, { user: 'usr_2', start: false });
    c.keys.write({ key: Buffer.alloc(32).toString('base64'), salt: Buffer.alloc(16).toString('base64'), userId: 'usr_1' });
    c.state.write(freshState(true));
    c.engine.start();
    await c.engine.idle();
    expect(cloud.calls).toEqual([]);
    expect(c.keys.read()).toBeNull();
    expect(c.status()).toMatchObject({ kind: 'off' });
  });

  it('a user that changes while running deletes the key before the next request', async () => {
    const [a] = await pair();
    const before = cloud.calls.length;
    a.setUser('usr_9');
    await a.engine.now();
    expect(cloud.calls.length).toBe(before);
    expect(a.keys.read()).toBeNull();
  });

  it('publishes a status only when it changes', async () => {
    const [a] = await pair();
    const count = a.statuses.length;
    await a.engine.now();
    await a.engine.now();
    expect(a.statuses.length).toBe(count);
  });

  it('switching a group back on syncs it', async () => {
    const [a, b] = await pair();
    await b.engine.setGroup('automation', false);
    a.write('skills/late/SKILL.md', 'late');
    await a.engine.now();
    await b.engine.now();
    expect(b.read('skills/late/SKILL.md')).toBeNull();
    await b.engine.setGroup('automation', true);
    await b.engine.idle();
    expect(b.read('skills/late/SKILL.md')).toBe('late');
  });
});

describe('review round (task 8)', () => {
  it('a probe from before a reset elsewhere is not reused: the new passphrase joins', async () => {
    const [a] = await pair();
    const c = makeMac('C', cloud);
    expect(await c.engine.refresh()).toMatchObject({ kind: 'off', cloud: 'present' });
    await a.engine.reset();
    expect(await a.engine.setup('a brand new passphrase')).toEqual({ ok: true });
    await a.engine.idle();
    expect(await c.engine.setup('a brand new passphrase')).toEqual({ ok: true });
    await c.engine.idle();
    expect(c.read('skills/mine/SKILL.md')).toBe('mine');
  });

  it('a reset pressed during a run waits for it, and the run writes nothing afterwards', async () => {
    const [a] = await pair();
    let resetting: Promise<unknown> = Promise.resolve();
    cloud.beforeNextPut(() => {
      resetting = a.engine.reset();
      return Promise.resolve();
    });
    a.write('skills/a/SKILL.md', 'more');
    await a.engine.now();
    expect(await resetting).toEqual({ ok: true });
    expect(a.state.read()).toBeNull();
    expect(a.keys.read()).toBeNull();
    expect(a.status()).toEqual({ kind: 'off', cloud: 'none', resetElsewhere: false });
    expect(cloud.blob()).toBeNull();
  });

  it('a stop with wipe during a run sends nothing more with the old key and recreates no state', async () => {
    let wipeDuringApply = false;
    let engine: SyncEngine | null = null;
    const a = makeMac('A', cloud, { doc: { claudeCommand: 'claude' } });
    a.write('skills/mine/SKILL.md', 'mine');
    await a.engine.setup(PASS);
    await a.engine.idle();
    const b = makeMac('B', cloud, {
      apply: (real) => async (result, kept) => {
        if (wipeDuringApply) engine?.stop({ wipe: true });
        return real(result, kept);
      },
    });
    engine = b.engine;
    await b.engine.setup(PASS);
    await b.engine.idle();
    b.write('skills/b/SKILL.md', 'from B');
    wipeDuringApply = true;
    const before = puts(b).length;
    await b.engine.now();
    expect(puts(b).length).toBe(before);
    expect(b.keys.read()).toBeNull();
    expect(b.state.read()).toBeNull();
    expect(b.statuses.at(-1)).toEqual({ kind: 'off', cloud: 'unknown', resetElsewhere: false });
  });

  it('a trigger during the run that got a 429 waits too', async () => {
    const [a] = await pair();
    let before = 0;
    cloud.force('PUT', () => {
      void a.engine.now();
      before = a.calls().length;
      return cloud.json({ error: 'rate_limited' }, 429, { 'retry-after': '7' });
    });
    a.write('skills/a/SKILL.md', 'more');
    await a.engine.now();
    expect(a.calls().length).toBe(before);
    await vi.advanceTimersByTimeAsync(6_999);
    await a.engine.idle();
    expect(a.calls().length).toBe(before);
  });

  it('a set-up still deriving its key when the engine stops stores nothing', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const a = makeMac('A', cloud);
    // Re-create A's engine with a deriveKey that waits for the test.
    const keys = a.keys;
    const engine = createSyncEngine({
      fetch: cloud.fetchFor('A2'),
      userId: () => 'usr_1',
      keys,
      state: a.state,
      readDocument: () => ({}),
      collectFiles: () => Promise.resolve({}),
      apply: () => Promise.resolve({ configOk: true, kept: {}, skipped: [] }),
      conflicts: () => Promise.resolve({ count: 0, latest: null }),
      deriveKey: async (passphrase, salt) => {
        await gate;
        return cheap(passphrase, salt);
      },
      now: () => Date.now(),
      onStatus: () => undefined,
    });
    engines.push(engine);
    engine.start();
    const pending = engine.setup(PASS);
    await vi.waitFor(() => expect(cloud.calls.some((call) => call.mac === 'A2')).toBe(true), { interval: 1 });
    engine.stop({ wipe: true });
    release();
    expect((await pending).ok).toBe(false);
    expect(keys.read()).toBeNull();
    expect(a.state.read()).toBeNull();
  });

  it('a set-up that cannot save answers instead of throwing', async () => {
    const a = makeMac('A', cloud, {
      state: (real) => ({
        ...real,
        write: () => {
          throw new Error('EACCES');
        },
      }),
    });
    expect(await a.engine.setup(PASS)).toEqual({ ok: false, error: "Couldn't store the sync key on this Mac." });
  });
});

describe('failure pass', () => {
  it('an apply that throws mid-way is apply-failed; the base holds and the next run finishes', async () => {
    let fail = false;
    const a = makeMac('A', cloud);
    a.write('skills/one/SKILL.md', '1');
    a.write('skills/two/SKILL.md', '2');
    await a.engine.setup(PASS);
    await a.engine.idle();
    const b = makeMac('B', cloud, {
      apply: (real) => async (result, kept) => {
        if (fail) {
          fail = false;
          const [id] = Object.keys(result.set);
          await real({ ...result, set: id === undefined ? {} : { [id]: result.set[id]! } }, kept);
          throw new Error('disk full');
        }
        return real(result, kept);
      },
    });
    fail = true;
    await b.engine.setup(PASS);
    await b.engine.idle();
    expect(problemOf(b.status())).toBe('apply-failed');
    await b.engine.now();
    expect(problemOf(b.status())).toBeNull();
    expect([b.read('skills/one/SKILL.md'), b.read('skills/two/SKILL.md')]).toEqual(['1', '2']);
  });

  it('a state file that cannot be written is apply-failed, and the next run redoes the merge', async () => {
    let fail = false;
    const [a] = await pair();
    const b = makeMac('B2', cloud, {
      state: (real) => ({
        ...real,
        write: (state) => {
          if (fail) {
            fail = false;
            throw new Error('EACCES');
          }
          real.write(state);
        },
      }),
    });
    await b.engine.setup(PASS);
    await b.engine.idle();
    a.doc = { claudeCommand: 'claude-a' };
    await a.engine.now();
    fail = true;
    await b.engine.now();
    expect(problemOf(b.status())).toBe('apply-failed');
    await b.engine.now();
    expect(problemOf(b.status())).toBeNull();
    expect(b.doc).toEqual({ claudeCommand: 'claude-a' });
  });

  it('a Mac that died between storing its key and its first push creates the blob at the next start', async () => {
    const a = makeMac('A', cloud, { start: false });
    const salt = Buffer.alloc(16, 5);
    const key = await cheap(PASS, salt);
    a.keys.write({ key: key.toString('base64'), salt: salt.toString('base64'), userId: 'usr_1' });
    a.state.write(freshState(true));
    a.write('skills/a/SKILL.md', 'a');
    a.engine.start();
    await a.engine.idle();
    expect(cloud.blob()?.revision).toBe(1);
    expect(a.status()).toMatchObject({ kind: 'on', problem: null });
  });

  it('a config document that cannot be read is apply-failed and changes nothing', async () => {
    const [a] = await pair();
    a.doc = null as unknown as Record<string, unknown>;
    await a.engine.now();
    expect(problemOf(a.status())).toBe('apply-failed');
  });
});

describe('self review round (PR 322)', () => {
  it('a synced skill that cannot land through a linked skills/ is never read as a delete and pushed', async () => {
    const a = makeMac('A', cloud);
    a.write('skills/mine/SKILL.md', 'mine');
    expect(await a.engine.setup(PASS)).toEqual({ ok: true });
    await a.engine.idle();
    const b = makeMac('B', cloud, { start: false });
    mkdirSync(join(b.dir, 'elsewhere'));
    symlinkSync(join(b.dir, 'elsewhere'), join(b.dir, 'skills'));
    b.engine.start();
    expect(await b.engine.setup(PASS)).toEqual({ ok: true });
    await b.engine.idle();
    await b.engine.now();
    await b.engine.now();
    expect((await cloudView(cloud, a))?.['automation:f:skills/mine/SKILL.md']).toBeDefined();
    await a.engine.now();
    expect(a.read('skills/mine/SKILL.md')).toBe('mine');
  });

  it('a group switched during a run stays switched once the run writes its state', async () => {
    let during: (() => Promise<void>) | null = null;
    const a = makeMac('A', cloud, {
      doc: { claudeCommand: 'claude' },
      apply: (real) => async (result, kept) => {
        const hook = during;
        during = null;
        if (hook !== null) await hook();
        return real(result, kept);
      },
    });
    expect(await a.engine.setup(PASS)).toEqual({ ok: true });
    await a.engine.idle();
    during = () => a.engine.setGroup('harnesses', false);
    a.doc = { claudeCommand: 'claude-2' };
    await a.engine.now();
    await a.engine.idle();
    expect(a.state.read()?.groups.harnesses).toBe(false);
    expect(a.status()).toMatchObject({ kind: 'on', groups: { harnesses: false } });
  });

  it('a first join whose config write was refused is still a first join on the retry: the synced copy wins', async () => {
    const a = makeMac('A', cloud, { doc: { claudeCommand: 'claude' } });
    expect(await a.engine.setup(PASS)).toEqual({ ok: true });
    await a.engine.idle();
    vi.setSystemTime(Date.now() + 60_000);
    const b = makeMac('B', cloud, { doc: { claudeCommand: 'claude-b' } });
    b.refuseConfig(true);
    expect(await b.engine.setup(PASS)).toEqual({ ok: true });
    await b.engine.idle();
    expect(problemOf(b.status())).toBe('apply-failed');
    b.refuseConfig(false);
    await b.engine.now();
    expect(problemOf(b.status())).toBeNull();
    expect(b.doc).toEqual({ claudeCommand: 'claude' });
    await a.engine.now();
    expect(a.doc).toEqual({ claudeCommand: 'claude' });
  });
});
