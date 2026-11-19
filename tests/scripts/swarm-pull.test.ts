// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSwarmTag } from '@shared/swarm-contract';

import { hashTree, LOCK_FILE, pullSwarm, readLock, SWARM_REPO } from '../../scripts/swarm-pull.mjs';

interface Read {
  manifest: { version: string } | null;
  problems: { field: string; reason: string }[];
}

let root: string;
let work: string;
let bare: string;
let resources: string;

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const manifest = (version: string): string => `${JSON.stringify({ version })}\n`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hive-swarm-pull-test-'));
  work = join(root, 'work');
  bare = join(root, 'bare.git');
  resources = join(root, 'resources');

  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'tag.gpgsign', 'false');
  write(join(work, 'standard', 'swarm.json'), manifest('1.0.0'));
  write(join(work, 'standard', 'skills', 'tdd', 'SKILL.md'), '# tdd from the repo\n');
  write(join(work, 'standard', 'skills', 'tdd', 'notes.md'), 'notes\n');
  write(join(work, 'standard', 'agents', 'helper', 'AGENT.md'), '# helper from the repo\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'one');
  git(work, 'tag', 'standard/v1.0.0');
  rmSync(join(work, 'standard', 'skills', 'tdd', 'notes.md'));
  write(join(work, 'standard', 'swarm.json'), manifest('1.0.1'));
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'two');
  git(work, 'tag', 'standard/v1.0.1');
  git(root, 'clone', '-q', '--bare', work, bare);

  write(join(resources, 'agents', 'old', 'AGENT.md'), '# old\n');
  write(join(resources, 'agents', 'README.md'), 'placeholder\n');
  write(join(resources, 'skills', 'tdd', 'SKILL.md'), '# hand edited\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Reads the version from the swarm.json in the directory it is given, as readSwarm would. */
const fileReader = (dir: string): Promise<Read> => {
  const { version } = JSON.parse(readFileSync(join(dir, 'swarm.json'), 'utf8')) as { version: string };
  return Promise.resolve({ manifest: { version }, problems: [] });
};

const pull = (tag: string, readSwarm: (dir: string) => Promise<Read> = fileReader) =>
  pullSwarm({ tag, repoUrl: bare, resourcesDir: resources, readSwarm, parseSwarmTag });

const expectUntouched = (): void => {
  expect(readFileSync(join(resources, 'agents', 'old', 'AGENT.md'), 'utf8')).toBe('# old\n');
  expect(readFileSync(join(resources, 'skills', 'tdd', 'SKILL.md'), 'utf8')).toBe('# hand edited\n');
  expect(existsSync(join(resources, LOCK_FILE))).toBe(false);
};

describe('pullSwarm', () => {
  it('replaces agents/ and skills/ with the tag and writes a lock of their hashes', async () => {
    const lock = await pull('standard/v1.0.0');

    expect(existsSync(join(resources, 'skills', 'tdd', 'notes.md'))).toBe(true);
    expect(existsSync(join(resources, 'agents', 'old'))).toBe(false);
    expect(existsSync(join(resources, 'agents', 'README.md'))).toBe(false);
    expect(readFileSync(join(resources, 'agents', 'helper', 'AGENT.md'), 'utf8')).toBe('# helper from the repo\n');

    expect(lock.tag).toBe('standard/v1.0.0');
    expect(lock.repo).toBe(SWARM_REPO);
    expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.commit).toBe(git(work, 'rev-parse', 'standard/v1.0.0^{commit}'));
    expect(lock.files).toEqual(hashTree(resources));
    expect(Object.keys(lock.files)).toEqual([
      'agents/helper/AGENT.md',
      'skills/tdd/SKILL.md',
      'skills/tdd/notes.md',
    ]);

    const onDisk = readFileSync(join(resources, LOCK_FILE), 'utf8');
    expect(onDisk.endsWith('\n')).toBe(true);
    expect(JSON.parse(onDisk)).toEqual(lock);
  });

  it('deletes a file the newer tag deleted', async () => {
    await pull('standard/v1.0.0');
    const lock = await pull('standard/v1.0.1');

    expect(existsSync(join(resources, 'skills', 'tdd', 'notes.md'))).toBe(false);
    expect(Object.keys(lock.files)).not.toContain('skills/tdd/notes.md');
  });

  it('refuses a swarm with problems, naming the field, and leaves resources/ as it was', async () => {
    const broken = (): Promise<Read> =>
      Promise.resolve({ manifest: { version: '1.0.0' }, problems: [{ field: 'requires.app', reason: 'is not a range' }] });

    await expect(pull('standard/v1.0.0', broken)).rejects.toThrow(/requires\.app/);
    expectUntouched();
  });

  it('refuses a tag the repo does not have and leaves resources/ as it was', async () => {
    await expect(pull('standard/v9.9.9')).rejects.toThrow();
    expectUntouched();
  });

  it('refuses a tag that does not parse before cloning anything', async () => {
    await expect(
      pullSwarm({
        tag: 'nonsense',
        repoUrl: join(root, 'no-such-repo'),
        resourcesDir: resources,
        readSwarm: fileReader,
        parseSwarmTag,
      }),
    ).rejects.toThrow(/nonsense is not/);
    expectUntouched();
  });

  it.each(['other/v1.0.0', 'v1.0.0'])('refuses %s, a tag outside standard/, before cloning anything', async (tag) => {
    await expect(
      pullSwarm({
        tag,
        repoUrl: join(root, 'no-such-repo'),
        resourcesDir: resources,
        readSwarm: fileReader,
        parseSwarmTag,
      }),
    ).rejects.toThrow(/is not a standard\/ tag/);
    expectUntouched();
  });

  it('refuses a swarm.json version that differs from the tag, naming both', async () => {
    const other = (): Promise<Read> => Promise.resolve({ manifest: { version: '2.0.0' }, problems: [] });

    await expect(pull('standard/v1.0.0', other)).rejects.toThrow(/is version 1\.0\.0 but its swarm\.json says 2\.0\.0/);
    expectUntouched();
  });
});

describe('readLock', () => {
  it('reads the lock it finds', () => {
    const lock = { repo: SWARM_REPO, tag: 'standard/v1.0.0', commit: 'a'.repeat(40), files: {} };
    write(join(resources, LOCK_FILE), JSON.stringify(lock));

    expect(readLock(resources)).toEqual(lock);
  });

  it('names pnpm swarm:pull when the lock is missing', () => {
    expect(() => readLock(resources)).toThrow(/swarm\.lock\.json.*pnpm swarm:pull <tag>/s);
  });

  it('names pnpm swarm:pull when the lock is not JSON', () => {
    write(join(resources, LOCK_FILE), '{"repo": ');

    expect(() => readLock(resources)).toThrow(/swarm\.lock\.json.*pnpm swarm:pull <tag>/s);
  });
});

describe('hashTree', () => {
  it('skips .DS_Store and changes a path’s hash when a byte changes', () => {
    write(join(resources, 'skills', 'tdd', '.DS_Store'), 'finder');
    const before = hashTree(resources);

    expect(Object.keys(before)).toEqual(['agents/README.md', 'agents/old/AGENT.md', 'skills/tdd/SKILL.md']);

    write(join(resources, 'skills', 'tdd', 'SKILL.md'), '# hand edited!\n');
    const after = hashTree(resources);

    expect(after['skills/tdd/SKILL.md']).not.toBe(before['skills/tdd/SKILL.md']);
    expect(after['agents/old/AGENT.md']).toBe(before['agents/old/AGENT.md']);
  });

  it('answers an empty map for a folder with neither kind', () => {
    expect(hashTree(join(root, 'empty'))).toEqual({});
  });
});
