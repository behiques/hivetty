// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstalledSwarm, SwarmEntry } from '@shared/swarm-contract';

import { baseOf } from '../../../core/seed/merge';
import { seedShipped } from '../../../core/seed/seed';
import { collectFiles } from '../../../core/sync/bundle';
import { createSwarmGit } from '../../../core/swarms/git';
import { createSwarms, mergeListing, readInstalled, takeOver, type SwarmDeps } from '../../../core/swarms/install';

/**
 * Installing a swarm (HIVE-441): Git runs for real against bare repositories in a temp dir, the seeder runs for
 * real into a temp `~/.hivetty`, and only the cloud's clone token is a fake.
 */

let root: string;
let hiveDir: string;
let repoCount = 0;

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A bare repository with one commit per release, each tagged. */
function makeRepo(releases: { tag?: string; files: Record<string, string> }[]): {
  bare: string;
  commitOf(tag: string): string;
} {
  repoCount += 1;
  const work = join(root, `work-${String(repoCount)}`);
  const bare = join(root, `bare-${String(repoCount)}.git`);
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'tag.gpgsign', 'false');
  for (const release of releases) {
    for (const [rel, text] of Object.entries(release.files)) write(join(work, rel), text);
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '--allow-empty', '-m', release.tag ?? 'untagged');
    if (release.tag !== undefined) git(work, 'tag', release.tag);
  }
  git(root, 'clone', '-q', '--bare', work, bare);
  git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  return { bare, commitOf: (tag) => git(bare, 'rev-list', '-n', '1', tag) };
}

const skillText = (name: string, body = 'body'): string => `---\nname: ${name}\ndescription: Does ${name}.\n---\n${body}\n`;
const agentText = (name: string): string =>
  `---\nname: ${name}\ndescription: Helps out.\nicon: Ghost\nskills: []\ntools: [Read, Bash]\n---\nWait to be asked.\n`;

/** A valid swarm's files under `standard/`. */
function swarmFiles(
  version: string,
  options: {
    agents?: string[];
    skills?: string[];
    title?: string | null;
    minApp?: string;
    body?: string;
    extra?: Record<string, string>;
  } = {},
): Record<string, string> {
  const manifest: Record<string, unknown> = {
    name: 'standard',
    title: options.title === undefined ? 'Standard' : options.title,
    description: 'Ticket to merge.',
    publisher: 'HiveTTY',
    version,
    tags: [],
  };
  if (manifest['title'] === null) delete manifest['title'];
  if (options.minApp !== undefined) manifest['minApp'] = options.minApp;
  const files: Record<string, string> = { 'standard/swarm.json': `${JSON.stringify(manifest)}\n` };
  for (const name of options.agents ?? ['a1']) files[`standard/agents/${name}/AGENT.md`] = agentText(name);
  for (const name of options.skills ?? ['s1']) {
    files[`standard/skills/${name}/SKILL.md`] = skillText(name, options.body ?? 'body');
  }
  for (const [rel, text] of Object.entries(options.extra ?? {})) files[`standard/${rel}`] = text;
  return files;
}

const entryFor = (overrides: Partial<SwarmEntry> = {}): SwarmEntry => ({
  id: 'sw1',
  slug: 'standard',
  kind: 'community',
  title: 'Standard',
  description: 'Ticket to merge.',
  publisher: 'HiveTTY',
  tags: [],
  version: '1.0.0',
  updatedAt: '2026-11-19T00:00:00Z',
  installs: 0,
  agents: [],
  skills: [],
  repoUrl: '/nowhere',
  folder: 'standard',
  commit: null,
  access: 'anonymous',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
  ...overrides,
});

/** A community entry for one tagged release of a fresh repository. */
function released(version: string, options: Parameters<typeof swarmFiles>[1] = {}, overrides: Partial<SwarmEntry> = {}) {
  const tag = `standard/v${version}`;
  const repo = makeRepo([{ tag, files: swarmFiles(version, options) }]);
  return { repo, entry: entryFor({ repoUrl: repo.bare, version, commit: repo.commitOf(tag), ...overrides }) };
}

let cloneToken: ReturnType<typeof vi.fn<SwarmDeps['cloneToken']>>;

const makeDeps = (overrides: Partial<SwarmDeps> = {}): SwarmDeps => ({
  hiveDir,
  shippedManifest: join(hiveDir, '.seed.json'),
  appVersion: '1.0.0',
  git: createSwarmGit({ env: () => process.env, askpass: join(hiveDir, 'swarms/askpass.sh') }),
  cloneToken,
  now: () => new Date('2026-11-19T12:00:00Z'),
  ...overrides,
});

const hive = (rel: string): string => join(hiveDir, rel);
const readHive = (rel: string): string => readFileSync(hive(rel), 'utf8');
const readJson = <T>(rel: string): T => JSON.parse(readHive(rel)) as T;
const installedJson = (): InstalledSwarm[] => (existsSync(hive('swarms/installed.json')) ? readJson('swarms/installed.json') : []);

/** Every file under `dir`, as absolute paths. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hive-swarm-install-'));
  hiveDir = join(root, 'hive');
  mkdirSync(hiveDir);
  cloneToken = vi.fn<SwarmDeps['cloneToken']>();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('install', () => {
  it('installs a community swarm: files seeded, clone swapped in, manifest and entry written', async () => {
    const { entry, repo } = released('1.0.0');
    const result = await createSwarms(makeDeps()).install(entry);

    expect(result.ok).toBe(true);
    expect(readHive('skills/s1/SKILL.md')).toBe(skillText('s1'));
    expect(readHive('agents/a1/AGENT.md')).toBe(agentText('a1'));
    expect(existsSync(hive('swarms/sw1/repo/standard/swarm.json'))).toBe(true);
    expect(existsSync(hive('swarms/sw1/repo.new'))).toBe(false);
    expect(Object.keys(readJson<{ files: object }>('swarms/sw1/seed.json').files).sort()).toEqual([
      'agents/a1/AGENT.md',
      'skills/s1/SKILL.md',
    ]);
    expect(installedJson()).toEqual([
      {
        swarmId: 'sw1',
        slug: 'standard',
        kind: 'community',
        org: null,
        repoUrl: repo.bare,
        folder: 'standard',
        version: '1.0.0',
        commit: repo.commitOf('standard/v1.0.0'),
        installedAt: '2026-11-19T12:00:00.000Z',
        autoUpdate: false,
        lastError: null,
        title: 'Standard',
        description: 'Ticket to merge.',
        contents: {
          agents: [{ name: 'a1', description: 'Helps out.', tools: ['Read', 'Bash'] }],
          skills: [{ name: 's1', description: 'Does s1.' }],
        },
      },
    ]);
    expect(result.ok && result.installed.description).toBe('Ticket to merge.');
    expect(cloneToken).not.toHaveBeenCalled();
  });

  it('installs a native swarm with a minted token, and leaves the token in no file', async () => {
    const { entry } = released('1.0.0', {}, { kind: 'native', access: 'token' });
    cloneToken.mockResolvedValue({ token: 'ghs_secret_token', repoUrl: entry.repoUrl });

    const result = await createSwarms(makeDeps()).install(entry);

    expect(result).toMatchObject({ ok: true, installed: { autoUpdate: true } });
    expect(cloneToken).toHaveBeenCalledWith('sw1');
    const files = filesUnder(hive('swarms'));
    expect(files).toContain(hive('swarms/sw1/repo/.git/config'));
    expect(files).toContain(hive('swarms/installed.json'));
    for (const file of files) expect(readFileSync(file).toString('latin1')).not.toContain('ghs_secret_token');
  });

  it('refuses a token for a repository the registry did not name', async () => {
    const { entry } = released('1.0.0', {}, { kind: 'native', access: 'token' });
    cloneToken.mockResolvedValue({ token: 'ghs_secret_token', repoUrl: 'https://github.com/someone/else' });

    const result = await createSwarms(makeDeps()).install(entry);

    expect(result).toMatchObject({ ok: false, failure: { code: 'failed' } });
    expect(existsSync(hive('skills'))).toBe(false);
    expect(existsSync(hive('swarms/sw1'))).toBe(false);
  });

  it('answers the cloud’s refusal unchanged', async () => {
    const { entry } = released('1.0.0', {}, { kind: 'native', access: 'token' });
    const refusal = { code: 'unavailable' as const, message: 'Sign in to install swarms.' };
    cloneToken.mockResolvedValue(refusal);

    expect(await createSwarms(makeDeps()).install(entry)).toEqual({ ok: false, failure: refusal });
  });

  describe('an organization swarm', () => {
    const orgRepo = () =>
      makeRepo([
        { tag: 'standard/v1.0.0', files: swarmFiles('1.0.0') },
        { tag: 'standard/v1.1.0', files: swarmFiles('1.1.0') },
      ]);
    const orgEntry = (repoUrl: string, overrides: Partial<SwarmEntry> = {}): SwarmEntry =>
      entryFor({
        kind: 'organization',
        access: 'user',
        repoUrl,
        version: null,
        commit: null,
        org: { id: 'o1', name: 'Acme' },
        ...overrides,
      });

    it('installs the newest tag under the latest policy', async () => {
      const result = await createSwarms(makeDeps()).install(orgEntry(orgRepo().bare));
      expect(result).toMatchObject({ ok: true, installed: { version: '1.1.0', autoUpdate: true } });
    });

    it('installs the pinned version under the pinned policy', async () => {
      const repo = orgRepo();
      const result = await createSwarms(makeDeps()).install(
        orgEntry(repo.bare, { policy: 'pinned', pinnedVersion: '1.0.0' }),
      );
      expect(result).toMatchObject({ ok: true, installed: { version: '1.0.0', commit: repo.commitOf('standard/v1.0.0') } });
    });

    it('fails when no tag fits', async () => {
      const repo = makeRepo([{ files: swarmFiles('1.0.0') }]);
      expect(await createSwarms(makeDeps()).install(orgEntry(repo.bare))).toEqual({
        ok: false,
        failure: { code: 'failed', message: `${repo.bare} has no released version.` },
      });
    });

    it('names the organization when Git cannot read the repository', async () => {
      const missing = join(root, 'missing.git');
      const result = await createSwarms(makeDeps()).install(
        orgEntry(missing, { policy: 'pinned', pinnedVersion: '1.0.0' }),
      );
      expect(result).toEqual({
        ok: false,
        failure: {
          code: 'no_access',
          message: `HiveTTY Pro can't read ${missing} with your Git sign-in. Ask an Owner or Admin of Acme to give your GitHub account access to that repository, then try again.`,
        },
      });
      expect(existsSync(hive('swarms/sw1'))).toBe(false);
    });
  });

  it('answers a bad id with a failure, never a rejection, and touches nothing', async () => {
    const result = await createSwarms(makeDeps()).install(entryFor({ id: '../x' }));
    expect(result).toMatchObject({ ok: false, failure: { code: 'failed' } });
    expect(readdirSync(hiveDir)).toEqual([]);
  });

  it('refuses a native or community row with no version as unavailable', async () => {
    const result = await createSwarms(makeDeps()).install(entryFor({ version: null }));
    expect(result).toMatchObject({ ok: false, failure: { code: 'unavailable' } });
  });

  it('refuses an invalid swarm and writes nothing', async () => {
    const { entry } = released('1.0.0', { title: null });
    const result = await createSwarms(makeDeps()).install(entry);

    expect(result).toMatchObject({ ok: false, failure: { code: 'invalid' } });
    expect(result.ok ? [] : result.failure.problems).not.toEqual([]);
    expect(existsSync(hive('skills'))).toBe(false);
    expect(existsSync(hive('swarms/sw1'))).toBe(false);
  });

  it('refuses a swarm that needs a newer app with the reader’s reason', async () => {
    const { entry } = released('1.0.0', { minApp: '2.0.0' });
    const result = await createSwarms(makeDeps()).install(entry);

    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'needs-newer-app', message: 'Needs HiveTTY Pro 2.0.0 or newer. This is 1.0.0.' },
    });
  });

  it('refuses a release whose swarm.json names another version', async () => {
    const repo = makeRepo([{ tag: 'standard/v1.0.0', files: swarmFiles('1.0.1') }]);
    const entry = entryFor({ repoUrl: repo.bare, version: '1.0.0', commit: repo.commitOf('standard/v1.0.0') });
    expect(await createSwarms(makeDeps()).install(entry)).toMatchObject({ ok: false, failure: { code: 'invalid' } });
  });

  it('refuses a second swarm that ships a name another swarm owns, naming both and writing nothing', async () => {
    const swarms = createSwarms(makeDeps());
    const a = released('1.0.0', { title: 'Alpha', skills: ['tdd'], agents: [] }, { id: 'swA', title: 'Alpha' });
    expect((await swarms.install(a.entry)).ok).toBe(true);
    const before = readHive('skills/tdd/SKILL.md');

    const b = released('1.0.0', { title: 'Beta', skills: ['tdd'], agents: [], body: 'beta' }, { id: 'swB', title: 'Beta' });
    expect(await swarms.install(b.entry)).toEqual({
      ok: false,
      failure: { code: 'collision', message: 'Beta and Alpha both provide the skill tdd.' },
    });
    expect(readHive('skills/tdd/SKILL.md')).toBe(before);
    expect(existsSync(hive('swarms/swB'))).toBe(false);
    expect(installedJson().map((held) => held.swarmId)).toEqual(['swA']);
  });

  describe('a folder the person already has as their own (HIVE-447)', () => {
    it('installs, leaves their bytes alone, and records the file as an edited file of the swarm', async () => {
      write(hive('skills/tdd/SKILL.md'), 'mine\n');
      const { entry } = released('1.0.0', { skills: ['tdd'], agents: [] });
      const swarms = createSwarms(makeDeps());

      expect(await swarms.install(entry)).toMatchObject({ ok: true });
      expect(readHive('skills/tdd/SKILL.md')).toBe('mine\n');
      const own = readJson<{ files: Record<string, string> }>('swarms/sw1/seed.json');
      expect(own.files['skills/tdd/SKILL.md']).toBe(sha(skillText('tdd')));

      expect(await swarms.remove('sw1')).toEqual({ ok: true });
      expect(readHive('skills/tdd/SKILL.md')).toBe('mine\n');
    });

    it('leaves their file on disk when a first install fails after seeding', async () => {
      write(hive('skills/tdd/SKILL.md'), 'mine\n');
      const { entry } = released('1.0.0', { skills: ['tdd'], agents: ['a1'] });
      const seed = vi.fn<NonNullable<SwarmDeps['seed']>>(async (options) => {
        await seedShipped(options);
        throw new Error('ENOSPC');
      });

      expect(await createSwarms(makeDeps({ seed })).install(entry)).toEqual({
        ok: false,
        failure: { code: 'failed', message: 'ENOSPC' },
      });
      expect(readHive('skills/tdd/SKILL.md')).toBe('mine\n');
      expect(existsSync(hive('agents/a1/AGENT.md'))).toBe(false);
      expect(existsSync(hive('swarms/sw1'))).toBe(false);
    });

    it.each<[string, NonNullable<SwarmDeps['seed']>]>([
      ['before the seed writes', () => Promise.reject(new Error('ENOSPC'))],
      [
        'after the seed wrote',
        async (options) => {
          await seedShipped(options);
          throw new Error('ENOSPC');
        },
      ],
    ])('keeps their file when it holds the swarm’s exact bytes and a first install fails %s', async (_when, fails) => {
      write(hive('skills/tdd/SKILL.md'), skillText('tdd'));
      const { entry } = released('1.0.0', { skills: ['tdd'], agents: ['a1'] });

      expect(await createSwarms(makeDeps({ seed: vi.fn(fails) })).install(entry)).toMatchObject({ ok: false });
      expect(readHive('skills/tdd/SKILL.md')).toBe(skillText('tdd'));
      expect(existsSync(hive('agents/a1/AGENT.md'))).toBe(false);
    });

    it('records a file that holds the swarm’s exact bytes as the swarm’s, so removing the swarm deletes it', async () => {
      write(hive('skills/tdd/SKILL.md'), skillText('tdd'));
      const { entry } = released('1.0.0', { skills: ['tdd'], agents: [] });
      const swarms = createSwarms(makeDeps());

      expect(await swarms.install(entry)).toMatchObject({ ok: true });
      const own = readJson<{ files: Record<string, string> }>('swarms/sw1/seed.json');
      expect(own.files['skills/tdd/SKILL.md']).toBe(sha(skillText('tdd')));

      expect(await swarms.remove('sw1')).toEqual({ ok: true });
      expect(existsSync(hive('skills/tdd/SKILL.md'))).toBe(false);
    });
  });

  describe('a built-in the swarm ships', () => {
    const OLD = skillText('tdd', 'Old body.');
    const NOTES = 'notes\n';

    beforeEach(() => {
      write(hive('skills/other/SKILL.md'), skillText('other'));
      write(hive('skills/tdd/notes.md'), NOTES);
      write(
        hive('.seed.json'),
        JSON.stringify({
          files: {
            'skills/tdd/SKILL.md': sha(OLD),
            'skills/tdd/notes.md': sha(NOTES),
            'skills/other/SKILL.md': sha(skillText('other')),
          },
          parts: { 'skills/tdd/SKILL.md': baseOf(OLD), 'skills/other/SKILL.md': baseOf(skillText('other')) },
        }),
      );
    });

    const expectMoved = (): void => {
      const shipped = readJson<{ files: object; parts: object }>('.seed.json');
      expect(Object.keys(shipped.files)).toEqual(['skills/other/SKILL.md']);
      expect(Object.keys(shipped.parts)).toEqual(['skills/other/SKILL.md']);
      const own = readJson<{ files: object; parts: object }>('swarms/sw1/seed.json');
      expect(Object.keys(own.files)).toEqual(expect.arrayContaining(['skills/tdd/SKILL.md', 'skills/tdd/notes.md']));
      expect(Object.keys(own.parts)).toContain('skills/tdd/SKILL.md');
    };

    it('upgrades an untouched one and takes its manifest entries over', async () => {
      write(hive('skills/tdd/SKILL.md'), OLD);
      const { entry } = released('1.0.0', { skills: ['tdd'], agents: [], body: 'New body.' });

      expect((await createSwarms(makeDeps()).install(entry)).ok).toBe(true);
      expect(readHive('skills/tdd/SKILL.md')).toBe(skillText('tdd', 'New body.'));
      expectMoved();
    });

    it('keeps the person’s body in an edited one, and still moves the entries', async () => {
      write(hive('skills/tdd/SKILL.md'), skillText('tdd', 'Mine.'));
      const { entry } = released('1.0.0', { skills: ['tdd'], agents: [], body: 'New body.' });

      expect((await createSwarms(makeDeps()).install(entry)).ok).toBe(true);
      expect(readHive('skills/tdd/SKILL.md')).toContain('Mine.');
      expectMoved();
    });

    describe('when the seed throws on a first install', () => {
      const throwingSeed = vi.fn<NonNullable<SwarmDeps['seed']>>(async (options) => {
        await seedShipped(options);
        throw new Error('ENOSPC');
      });

      it('gives the built-ins back their entries for the files that stay, and the retry installs', async () => {
        write(hive('skills/tdd/SKILL.md'), skillText('tdd', 'Mine.'));
        const { entry } = released('1.0.0', { skills: ['tdd'], agents: [], body: 'New body.' });

        expect(await createSwarms(makeDeps({ seed: throwingSeed })).install(entry)).toMatchObject({ ok: false });
        const shipped = readJson<{ files: object; parts: object }>('.seed.json');
        expect(Object.keys(shipped.files).sort()).toEqual([
          'skills/other/SKILL.md',
          'skills/tdd/SKILL.md',
          'skills/tdd/notes.md',
        ]);
        expect(Object.keys(shipped.parts).sort()).toEqual(['skills/other/SKILL.md', 'skills/tdd/SKILL.md']);
        expect(existsSync(hive('swarms/sw1'))).toBe(false);

        expect((await createSwarms(makeDeps()).install(entry)).ok).toBe(true);
      });

      it('drops the entry of a built-in the undo deleted, so the boot seed brings it back', async () => {
        write(hive('skills/tdd/SKILL.md'), OLD);
        const { entry } = released('1.0.0', { skills: ['tdd'], agents: [], body: 'New body.' });

        expect(await createSwarms(makeDeps({ seed: throwingSeed })).install(entry)).toMatchObject({ ok: false });
        expect(existsSync(hive('skills/tdd/SKILL.md'))).toBe(false);
        expect(Object.keys(readJson<{ files: object }>('.seed.json').files)).not.toContain('skills/tdd/SKILL.md');

        const resources = join(root, 'resources');
        write(join(resources, 'skills/tdd/SKILL.md'), OLD);
        await seedShipped({ source: resources, target: hiveDir, manifestFile: hive('.seed.json') });
        expect(readHive('skills/tdd/SKILL.md')).toBe(OLD);
      });
    });
  });

  it('takes its own files back out when the seed throws on a first install', async () => {
    const { entry } = released('1.0.0', { agents: [] });
    const seed = vi.fn<NonNullable<SwarmDeps['seed']>>((options) => {
      write(join(options.target, 'skills/s1/SKILL.md'), readFileSync(join(options.source, 'skills/s1/SKILL.md'), 'utf8'));
      return Promise.reject(new Error('ENOSPC'));
    });

    const result = await createSwarms(makeDeps({ seed })).install(entry);

    expect(result).toEqual({ ok: false, failure: { code: 'failed', message: 'ENOSPC' } });
    expect(existsSync(hive('skills/s1/SKILL.md'))).toBe(false);
    expect(existsSync(hive('swarms/sw1'))).toBe(false);
    expect(installedJson()).toEqual([]);
  });

  describe('a first install the app died in the middle of', () => {
    /** Seeds for real, then leaves `~/.hivetty` as a killed process would have: seeded files, no undo. */
    const dieMidSeed = async (entry: SwarmEntry): Promise<void> => {
      const crashed = join(root, 'crashed');
      const seed = vi.fn<NonNullable<SwarmDeps['seed']>>(async (options) => {
        write(join(options.target, 'skills/s1/SKILL.md'), readFileSync(join(options.source, 'skills/s1/SKILL.md'), 'utf8'));
        cpSync(hiveDir, crashed, { recursive: true });
        throw new Error('killed');
      });
      await createSwarms(makeDeps({ seed })).install(entry);
      rmSync(hiveDir, { recursive: true, force: true });
      cpSync(crashed, hiveDir, { recursive: true });
      expect(existsSync(hive('skills/s1/SKILL.md'))).toBe(true);
      expect(existsSync(hive('swarms/sw1/seed.json'))).toBe(false);
    };

    it('installs on the retry, adopting the files it left', async () => {
      const { entry } = released('1.0.0');
      await dieMidSeed(entry);

      expect((await createSwarms(makeDeps()).install(entry)).ok).toBe(true);
      expect(Object.keys(readJson<{ files: object }>('swarms/sw1/seed.json').files).sort()).toEqual([
        'agents/a1/AGENT.md',
        'skills/s1/SKILL.md',
      ]);
      expect(filesUnder(hive('swarms/sw1')).filter((file) => !file.includes(`${join('sw1', 'repo')}`))).toEqual([
        hive('swarms/sw1/seed.json'),
      ]);
    });

    it('adopts the files an older build listed in a bare pending map', async () => {
      const { entry } = released('1.0.0');
      await dieMidSeed(entry);
      const pending = readJson<{ files: Record<string, string> }>('swarms/sw1/pending.json');
      write(hive('swarms/sw1/pending.json'), JSON.stringify(pending.files));

      expect((await createSwarms(makeDeps()).install(entry)).ok).toBe(true);
      expect(existsSync(hive('swarms/sw1/pending.json'))).toBe(false);
    });

    it('keeps a file the person edited since, as an edited file of the swarm (HIVE-447)', async () => {
      const { entry } = released('1.0.0');
      await dieMidSeed(entry);
      write(hive('skills/s1/SKILL.md'), 'mine\n');

      expect(await createSwarms(makeDeps()).install(entry)).toMatchObject({ ok: true });
      expect(readHive('skills/s1/SKILL.md')).toBe('mine\n');
      expect(readJson<{ files: Record<string, string> }>('swarms/sw1/seed.json').files['skills/s1/SKILL.md']).toBe(
        sha(skillText('s1')),
      );
    });

    it('takes the files it left back out when the retry fails too, and keeps the one the person edited', async () => {
      const { entry } = released('1.0.0');
      await dieMidSeed(entry);
      write(hive('agents/a1/AGENT.md'), 'mine\n');
      const seed = vi.fn<NonNullable<SwarmDeps['seed']>>(() => Promise.reject(new Error('ENOSPC')));

      expect(await createSwarms(makeDeps({ seed })).install(entry)).toMatchObject({ ok: false, failure: { code: 'failed' } });
      expect(existsSync(hive('skills/s1'))).toBe(false);
      expect(readHive('agents/a1/AGENT.md')).toBe('mine\n');
    });
  });

  describe('an installed.json it cannot read', () => {
    it('names the folder the app really uses, so a dev build says ~/.hivetty-dev', async () => {
      const devHive = join(root, '.hivetty-dev');
      write(join(devHive, 'swarms/installed.json'), 'not json');
      const { entry } = released('1.0.0');

      const result = await createSwarms(makeDeps({ hiveDir: devHive, shippedManifest: join(devHive, '.seed.json') })).install(entry);

      expect(result).toMatchObject({ ok: false, failure: { code: 'failed' } });
      expect(result).toMatchObject({
        failure: { message: expect.stringMatching(/^~\/\.hivetty-dev\/swarms\/installed\.json can't be read/) as unknown },
      });
    });

    it('refuses to install, and leaves the file as it was', async () => {
      write(hive('swarms/installed.json'), 'not json');
      const { entry } = released('1.0.0');

      expect(await createSwarms(makeDeps()).install(entry)).toMatchObject({ ok: false, failure: { code: 'failed' } });
      expect(readHive('swarms/installed.json')).toBe('not json');
      expect(existsSync(hive('skills'))).toBe(false);
    });

    it('refuses to remove, and deletes no file', async () => {
      const swarms = createSwarms(makeDeps());
      expect((await swarms.install(released('1.0.0').entry)).ok).toBe(true);
      write(hive('swarms/installed.json'), 'not json');

      expect(await swarms.remove('sw1')).toMatchObject({ ok: false, failure: { code: 'failed' } });
      expect(readHive('swarms/installed.json')).toBe('not json');
      expect(existsSync(hive('skills/s1/SKILL.md'))).toBe(true);
    });

    it('keeps an entry it cannot read when an install or a removal writes the list back', async () => {
      const odd = { swarmId: '../x', folder: 'standard', note: 'kept' };
      write(hive('swarms/installed.json'), JSON.stringify([odd]));
      const swarms = createSwarms(makeDeps());

      expect((await swarms.install(released('1.0.0').entry)).ok).toBe(true);
      expect(readJson<unknown[]>('swarms/installed.json')[0]).toEqual(odd);
      expect(await swarms.install({ ...released('1.0.0').entry, commit: 'f'.repeat(40) })).toMatchObject({ ok: false });
      expect(readJson<unknown[]>('swarms/installed.json')[0]).toEqual(odd);
      expect(await swarms.remove('sw1')).toEqual({ ok: true });
      expect(readJson<unknown[]>('swarms/installed.json')).toEqual([odd]);
    });
  });

  it('keeps an installed swarm at its version, with lastError, when a later install fails', async () => {
    const swarms = createSwarms(makeDeps());
    const { entry } = released('1.0.0');
    expect((await swarms.install(entry)).ok).toBe(true);

    const result = await swarms.install({ ...entry, commit: 'f'.repeat(40) });

    expect(result.ok).toBe(false);
    const [held] = installedJson();
    expect(held?.version).toBe('1.0.0');
    expect(held?.lastError?.code).toEqual(expect.any(String));
    expect(readHive('swarms/sw1/repo/standard/swarm.json')).toContain('"1.0.0"');
    expect(readHive('skills/s1/SKILL.md')).toBe(skillText('s1'));
    expect(existsSync(hive('swarms/sw1/repo.new'))).toBe(false);
  });

  it('reinstalls at a new version, keeping the autoUpdate the person set', async () => {
    const repo = makeRepo([
      { tag: 'standard/v1.0.0', files: swarmFiles('1.0.0') },
      { tag: 'standard/v1.1.0', files: swarmFiles('1.1.0', { body: 'new text' }) },
    ]);
    const swarms = createSwarms(makeDeps());
    const at = (version: string) =>
      entryFor({ repoUrl: repo.bare, version, commit: repo.commitOf(`standard/v${version}`) });
    expect((await swarms.install(at('1.0.0'))).ok).toBe(true);
    write(
      hive('swarms/installed.json'),
      JSON.stringify(installedJson().map((held) => ({ ...held, autoUpdate: true }))),
    );

    const result = await swarms.install(at('1.1.0'));

    expect(result).toMatchObject({ ok: true, installed: { version: '1.1.0', lastError: null, autoUpdate: true } });
    expect(readHive('skills/s1/SKILL.md')).toBe(skillText('s1', 'new text'));
    expect(installedJson()).toHaveLength(1);
  });

  it('asks installIf with the entry installed inside the queue, and installs nothing when it says no', async () => {
    const repo = makeRepo([
      { tag: 'standard/v1.0.0', files: swarmFiles('1.0.0') },
      { tag: 'standard/v1.1.0', files: swarmFiles('1.1.0', { body: 'new text' }) },
    ]);
    const swarms = createSwarms(makeDeps());
    const at = (version: string) =>
      entryFor({ repoUrl: repo.bare, version, commit: repo.commitOf(`standard/v${version}`) });
    const seen: (string | null)[] = [];
    const answer =
      (yes: boolean) =>
      (previous: InstalledSwarm | null): boolean => {
        seen.push(previous?.version ?? null);
        return yes;
      };
    expect(await swarms.installIf(at('1.0.0'), answer(true))).toMatchObject({ ok: true });
    const before = readHive('swarms/installed.json');

    const refused = await swarms.installIf(at('1.1.0'), answer(false));

    expect(refused).toBeNull();
    expect(seen).toEqual([null, '1.0.0']);
    expect(readHive('swarms/installed.json')).toBe(before);
    expect(readHive('skills/s1/SKILL.md')).toBe(skillText('s1'));
  });

  it('waits for the boot seed, then runs two installs one after the other', async () => {
    let open: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      open = resolve;
    });
    const swarms = createSwarms(makeDeps({ ready: () => ready }));
    const one = released('1.0.0', { skills: ['one'], agents: [] }, { id: 'swOne' });
    const two = released('1.0.0', { skills: ['two'], agents: [] }, { id: 'swTwo' });

    const first = swarms.install(one.entry);
    const second = swarms.install(two.entry);
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(existsSync(hive('swarms'))).toBe(false);
    expect(existsSync(hive('skills'))).toBe(false);

    open();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(installedJson().map((held) => held.swarmId).sort()).toEqual(['swOne', 'swTwo']);
    expect(statSync(hive('skills/one/SKILL.md')).isFile()).toBe(true);
  });
});

describe('setAutoUpdate', () => {
  const heldEntry = (swarmId: string, autoUpdate: boolean): InstalledSwarm => ({
    swarmId,
    slug: swarmId,
    kind: 'native',
    org: null,
    repoUrl: 'https://github.com/o/r',
    folder: 'standard',
    version: '1.0.0',
    commit: 'a'.repeat(40),
    installedAt: '2026-11-19T12:00:00.000Z',
    autoUpdate,
    lastError: null,
    title: swarmId,
    description: '',
    contents: { agents: [], skills: [] },
  });
  const junk = { nope: 1 };
  const seedList = (): void => {
    write(hive('swarms/installed.json'), `${JSON.stringify([heldEntry('a1', true), junk, heldEntry('b1', true)], null, 2)}\n`);
  };

  it('sets the flag on one swarm, answers the new entry, and writes every other row back as it was', async () => {
    seedList();
    const swarms = createSwarms(makeDeps());

    expect(await swarms.setAutoUpdate('a1', false)).toEqual({ ...heldEntry('a1', true), autoUpdate: false });
    expect(readJson<unknown[]>('swarms/installed.json')).toEqual([
      { ...heldEntry('a1', true), autoUpdate: false },
      junk,
      heldEntry('b1', true),
    ]);
  });

  it('answers null and writes nothing for a swarm that is not installed', async () => {
    seedList();
    const before = readHive('swarms/installed.json');

    expect(await createSwarms(makeDeps()).setAutoUpdate('zz', true)).toBeNull();
    expect(readHive('swarms/installed.json')).toBe(before);
  });

  it('answers null for an id that is not a swarm id', async () => {
    seedList();
    const before = readHive('swarms/installed.json');

    expect(await createSwarms(makeDeps()).setAutoUpdate('../x', true)).toBeNull();
    expect(readHive('swarms/installed.json')).toBe(before);
  });

  it('answers null and leaves an unreadable installed.json as it was', async () => {
    write(hive('swarms/installed.json'), 'not json');

    expect(await createSwarms(makeDeps()).setAutoUpdate('a1', false)).toBeNull();
    expect(readHive('swarms/installed.json')).toBe('not json');
  });

  it('answers null when installed.json cannot be written', async () => {
    seedList();
    mkdirSync(hive('swarms/installed.json.tmp')); // the temp file's path is taken by a folder

    expect(await createSwarms(makeDeps()).setAutoUpdate('a1', false)).toBeNull();
    expect(readJson<InstalledSwarm[]>('swarms/installed.json')[0]?.autoUpdate).toBe(true);
  });

  it('takes the install queue, so an install started in the same tick keeps the changed flag', async () => {
    seedList();
    const swarms = createSwarms(makeDeps());
    const { entry } = released('1.0.0', {}, { id: 'c1' });

    const [installed, set] = await Promise.all([swarms.install(entry), swarms.setAutoUpdate('a1', false)]);

    expect(installed.ok).toBe(true);
    expect(set?.autoUpdate).toBe(false);
    const rows = readJson<InstalledSwarm[]>('swarms/installed.json');
    expect(rows.find((row) => row.swarmId === 'a1')?.autoUpdate).toBe(false);
    expect(rows.map((row) => row.swarmId)).toContain('c1');
  });
});

describe('readInstalled', () => {
  it.each([
    ['not json', 'not json'],
    ['an object', '{}'],
    ['an entry with a bad id', JSON.stringify([{ swarmId: '../x', folder: 'standard' }])],
  ])('reads %s as nothing installed', async (_label, text) => {
    write(join(root, 'installed.json'), text);
    expect(await readInstalled(join(root, 'installed.json'))).toEqual([]);
  });

  it('reads an absent file as nothing installed', async () => {
    expect(await readInstalled(join(root, 'absent.json'))).toEqual([]);
  });
});

describe('remove', () => {
  const NOTES = 'notes\n';

  it('deletes untouched files and emptied folders, keeps an edited one, and drops the clone and the entry', async () => {
    const swarms = createSwarms(makeDeps());
    const { entry } = released('1.0.0', { extra: { 'skills/s1/notes.md': NOTES } });
    expect((await swarms.install(entry)).ok).toBe(true);
    write(hive('skills/s1/notes.md'), 'my notes\n');

    expect(await swarms.remove('sw1')).toEqual({ ok: true });

    expect(existsSync(hive('skills/s1/SKILL.md'))).toBe(false);
    expect(existsSync(hive('agents/a1'))).toBe(false);
    expect(readHive('skills/s1/notes.md')).toBe('my notes\n');
    expect(existsSync(hive('swarms/sw1'))).toBe(false);
    expect(installedJson()).toEqual([]);
    expect(statSync(hive('skills')).isDirectory()).toBe(true);
    expect(statSync(hive('agents')).isDirectory()).toBe(true);
  });

  it('answers ok for an id that is not installed', async () => {
    expect(await createSwarms(makeDeps()).remove('nothing')).toEqual({ ok: true });
  });

  it('refuses a bad id and touches nothing', async () => {
    write(join(root, 'x', 'seed.json'), '{}');
    expect(await createSwarms(makeDeps()).remove('../x')).toMatchObject({ ok: false, failure: { code: 'failed' } });
    expect(existsSync(join(root, 'x', 'seed.json'))).toBe(true);
  });

  it('never deletes a file outside the skill and agent folders, whatever the manifest says', async () => {
    const swarms = createSwarms(makeDeps());
    const { entry } = released('1.0.0');
    expect((await swarms.install(entry)).ok).toBe(true);
    write(join(root, 'outside.txt'), 'outside');
    write(hive('config.json'), '{}');
    write(
      hive('swarms/sw1/seed.json'),
      JSON.stringify({
        files: {
          '../outside.txt': sha('outside'),
          'config.json': sha('{}'),
          'skills/../../outside.txt': sha('outside'),
        },
        parts: {},
      }),
    );

    expect(await swarms.remove('sw1')).toEqual({ ok: true });

    expect(readFileSync(join(root, 'outside.txt'), 'utf8')).toBe('outside');
    expect(readHive('config.json')).toBe('{}');
  });

  it('never deletes through a linked folder', async () => {
    const swarms = createSwarms(makeDeps());
    const { entry } = released('1.0.0', { agents: [] });
    expect((await swarms.install(entry)).ok).toBe(true);
    const elsewhere = join(root, 'elsewhere');
    write(join(elsewhere, 'SKILL.md'), skillText('s1'));
    rmSync(hive('skills/s1'), { recursive: true });
    symlinkSync(elsewhere, hive('skills/s1'));

    expect(await swarms.remove('sw1')).toEqual({ ok: true });

    expect(readFileSync(join(elsewhere, 'SKILL.md'), 'utf8')).toBe(skillText('s1'));
  });

  it('waits its turn behind an install of the same swarm', async () => {
    const swarms = createSwarms(makeDeps());
    const { entry } = released('1.0.0');
    const order: string[] = [];

    await Promise.all([
      swarms.install(entry).then((result) => order.push(`install:${String(result.ok)}`)),
      swarms.remove('sw1').then((result) => order.push(`remove:${String(result.ok)}`)),
    ]);

    expect(order).toEqual(['install:true', 'remove:true']);
    expect(installedJson()).toEqual([]);
    expect(existsSync(hive('skills/s1/SKILL.md'))).toBe(false);
  });
});

describe('takeOver', () => {
  const A = skillText('a');
  const B = skillText('b');

  it('moves the taken folders’ entries with their hash and part base, keeps the others, and moves nothing twice', async () => {
    const shippedFile = hive('.seed.json');
    const mineFile = hive('swarms/sw1/seed.json');
    const shipped = {
      files: { 'skills/a/SKILL.md': sha(A), 'skills/a/notes.md': sha('n'), 'skills/b/SKILL.md': sha(B) },
      parts: { 'skills/a/SKILL.md': baseOf(A), 'skills/b/SKILL.md': baseOf(B) },
    };
    const mine = { files: { 'skills/a/notes.md': 'mine-already' }, parts: {} };

    await takeOver(shippedFile, shipped, mineFile, mine, new Set(['skills/a']));

    expect(readJson('swarms/sw1/seed.json')).toEqual({
      files: { 'skills/a/notes.md': 'mine-already', 'skills/a/SKILL.md': sha(A) },
      parts: { 'skills/a/SKILL.md': baseOf(A) },
    });
    expect(readJson('.seed.json')).toEqual({
      files: { 'skills/b/SKILL.md': sha(B) },
      parts: { 'skills/b/SKILL.md': baseOf(B) },
    });

    const mineBefore = readHive('swarms/sw1/seed.json');
    await takeOver(shippedFile, readJson('.seed.json'), mineFile, readJson('swarms/sw1/seed.json'), new Set(['skills/a']));
    expect(readHive('swarms/sw1/seed.json')).toBe(mineBefore);
    expect(readJson('.seed.json')).toEqual({
      files: { 'skills/b/SKILL.md': sha(B) },
      parts: { 'skills/b/SKILL.md': baseOf(B) },
    });
  });
});

describe('the seed sets (HIVE-448: installed swarms only)', () => {
  const installTwo = async () => {
    const swarms = createSwarms(makeDeps());
    const one = released('1.0.0', { skills: ['one'], agents: ['a1'] }, { id: 'swOne' });
    const two = released('1.0.0', { skills: ['two'], agents: [] }, { id: 'swTwo' });
    expect((await swarms.install(one.entry)).ok).toBe(true);
    expect((await swarms.install(two.entry)).ok).toBe(true);
    return swarms;
  };

  const setOf = (id: string) => ({
    source: hive(`swarms/${id}/repo/standard`),
    target: hiveDir,
    manifestFile: hive(`swarms/${id}/seed.json`),
  });

  it('gives each installed swarm its own set', async () => {
    const swarms = await installTwo();

    expect(await swarms.seedSets()).toEqual([setOf('swOne'), setOf('swTwo')]);
  });

  it('gives a bundled entry no set until its first update installs a real version (HIVE-447)', async () => {
    const held = (swarmId: string, version: string) => ({
      swarmId,
      slug: swarmId,
      kind: 'native',
      org: null,
      repoUrl: '/r',
      folder: 'standard',
      version,
      commit: 'c'.repeat(40),
      installedAt: '2026-11-19T00:00:00Z',
      autoUpdate: true,
      lastError: null,
      title: 'T',
      description: '',
      contents: { agents: [], skills: [] },
    });
    write(hive('swarms/installed.json'), JSON.stringify([held('bundled-dev-squad', 'bundled'), held('swOne', '1.0.0')]));
    write(hive('swarms/bundled-dev-squad/seed.json'), JSON.stringify({ files: { 'skills/tdd/SKILL.md': 'h' }, parts: {} }));
    const swarms = createSwarms(makeDeps());

    expect(await swarms.seedSets()).toEqual([setOf('swOne')]);
    expect(await swarms.seedSetFor('skills/tdd')).toBeNull();
  });

  it('answers no set with nothing installed', async () => {
    expect(await createSwarms(makeDeps()).seedSets()).toEqual([]);
  });

  it('answers the owning swarm’s set for its folder, and null for a folder no swarm owns', async () => {
    const swarms = await installTwo();

    expect(await swarms.seedSetFor('skills/two')).toEqual(setOf('swTwo'));
    expect(await swarms.seedSetFor('agents/a1')).toEqual(setOf('swOne'));
    expect(await swarms.seedSetFor('skills/tdd')).toBeNull();
  });
});

describe('the manifest files', () => {
  /** What settings sync would upload as the person's own, read through every manifest the swarms answer. */
  const synced = async (): Promise<string[]> =>
    Object.keys(await collectFiles(hiveDir, await createSwarms(makeDeps()).manifestFiles())).sort();

  it('names every installed swarm’s seed manifest', async () => {
    expect((await createSwarms(makeDeps()).install(released('1.0.0').entry)).ok).toBe(true);
    write(hive('skills/mine/SKILL.md'), 'mine\n');

    expect(await synced()).toEqual(['automation:f:skills/mine/SKILL.md']);
  });

  it('keeps a first install’s files out of sync while it seeds, before installed.json names it', async () => {
    let during: string[] = [];
    const seed = vi.fn<NonNullable<SwarmDeps['seed']>>(async (options) => {
      const report = await seedShipped(options);
      expect(installedJson()).toEqual([]);
      during = await synced();
      return report;
    });

    expect((await createSwarms(makeDeps({ seed })).install(released('1.0.0').entry)).ok).toBe(true);
    expect(seed).toHaveBeenCalledOnce();
    expect(during).toEqual([]);
  });

  it('keeps the files a first install the app died in left out of sync', async () => {
    const crashed = join(root, 'crashed');
    const seed = vi.fn<NonNullable<SwarmDeps['seed']>>(async (options) => {
      write(join(options.target, 'skills/s1/SKILL.md'), readFileSync(join(options.source, 'skills/s1/SKILL.md'), 'utf8'));
      cpSync(hiveDir, crashed, { recursive: true });
      throw new Error('killed');
    });
    await createSwarms(makeDeps({ seed })).install(released('1.0.0').entry);
    rmSync(hiveDir, { recursive: true, force: true });
    cpSync(crashed, hiveDir, { recursive: true });

    expect(await synced()).toEqual([]);
    // The retry still adopts what it left.
    expect((await createSwarms(makeDeps()).install(released('1.0.0').entry)).ok).toBe(true);
  });

  it('names every swarm’s manifest when installed.json cannot be read', async () => {
    expect((await createSwarms(makeDeps()).install(released('1.0.0').entry)).ok).toBe(true);
    write(hive('swarms/installed.json'), 'not json');

    expect(await synced()).toEqual([]);
  });
});

describe('mergeListing', () => {
  const installedFor = (swarmId: string): InstalledSwarm => ({
    swarmId,
    slug: swarmId,
    kind: 'community',
    org: null,
    repoUrl: 'https://github.com/o/r',
    folder: 'standard',
    version: '1.0.0',
    commit: 'a'.repeat(40),
    installedAt: '2026-11-19T12:00:00.000Z',
    autoUpdate: false,
    lastError: null,
    title: swarmId,
    description: '',
    contents: { agents: [], skills: [] },
  });

  it('puts registry rows first with their installed entry, then installed swarms the registry left out', () => {
    const a = entryFor({ id: 'A' });
    const b = entryFor({ id: 'B' });
    const listing = mergeListing({ source: 'cache', swarms: [a, b] }, [installedFor('C'), installedFor('A')]);

    expect(listing).toEqual({
      source: 'cache',
      items: [
        { entry: a, installed: installedFor('A'), update: null },
        { entry: b, installed: null, update: null },
        { entry: null, installed: installedFor('C'), update: null },
      ],
    });
  });

  it('carries the pending update of each installed swarm, asked for the ones the registry left out too', () => {
    const a = entryFor({ id: 'a1' });
    const b = entryFor({ id: 'b1' });
    const update = { target: '1.1.0', updating: false };
    const pending = vi.fn((id: string) => (id === 'a1' || id === 'c1' ? update : null));
    const listing = mergeListing({ source: 'cloud', swarms: [a, b] }, [installedFor('c1'), installedFor('a1')], pending);

    expect(listing.items).toEqual([
      { entry: a, installed: installedFor('a1'), update },
      { entry: b, installed: null, update: null },
      { entry: null, installed: installedFor('c1'), update },
    ]);
    expect(pending.mock.calls.map(([id]) => id).sort()).toEqual(['a1', 'c1']);
  });
});
