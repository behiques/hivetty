// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSwarmTag } from '@shared/swarm-contract';

import { findSwarmFolders, validateRepo } from '../../scripts/validate-swarm.mjs';

interface Read {
  manifest: { version: string } | null;
  problems: { field: string; reason: string }[];
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'hive-validate-swarm-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const swarmAt = (folder: string): void => {
  mkdirSync(join(repo, folder), { recursive: true });
  writeFileSync(join(repo, folder, 'swarm.json'), '{}', 'utf8');
};

/** A reader that answers from a map keyed by directory, as readSwarm would read it. */
const fakeReader =
  (reads: Record<string, Read>) =>
  (dir: string): Promise<Read> =>
    Promise.resolve(reads[dir] ?? { manifest: null, problems: [{ field: '', reason: 'unexpected dir' }] });

const ok = (version: string): Read => ({ manifest: { version }, problems: [] });

describe('findSwarmFolders', () => {
  it('answers the root for a repo with swarm.json at its root', () => {
    swarmAt('');
    swarmAt('also');

    expect(findSwarmFolders(repo)).toEqual(['']);
  });

  it('lists the subfolders that hold swarm.json, sorted, skipping dot folders', () => {
    swarmAt('b');
    swarmAt('a');
    swarmAt('.github');
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'README.md'), '# swarms\n', 'utf8');

    expect(findSwarmFolders(repo)).toEqual(['a', 'b']);
  });
});

describe('validateRepo', () => {
  const run = (reads: Record<string, Read>, tag?: string): Promise<string[]> =>
    validateRepo({
      repoDir: repo,
      ...(tag === undefined ? {} : { tag }),
      readSwarm: fakeReader(reads),
      parseSwarmTag,
    });

  it('fails a repoDir that is not a directory with a line, not a throw', async () => {
    const missing = join(repo, 'missing');

    expect(await validateRepo({ repoDir: missing, readSwarm: fakeReader({}), parseSwarmTag })).toEqual([
      `${missing} is not a directory`,
    ]);
  });

  it('fails a repo with no swarm in it', async () => {
    expect(await run({})).toEqual([`no swarm.json found in ${repo} or its folders`]);
  });

  it('prints each problem with its folder and field', async () => {
    swarmAt('a');

    const lines = await run({
      [join(repo, 'a')]: { manifest: null, problems: [{ field: 'version', reason: 'Must be x.y.z.' }] },
    });

    expect(lines).toEqual(['a: version: Must be x.y.z.']);
  });

  it('names the root as . and a whole-swarm problem as swarm', async () => {
    swarmAt('');

    const lines = await run({ [repo]: { manifest: null, problems: [{ field: '', reason: 'Empty.' }] } });

    expect(lines).toEqual(['.: swarm: Empty.']);
  });

  it('passes a tag that matches its swarm', async () => {
    swarmAt('a');
    swarmAt('b');

    expect(await run({ [join(repo, 'a')]: ok('1.0.0'), [join(repo, 'b')]: ok('2.0.0') }, 'a/v1.0.0')).toEqual([]);
  });

  it('fails a tag whose version differs from swarm.json', async () => {
    swarmAt('a');

    expect(await run({ [join(repo, 'a')]: ok('1.0.1') }, 'a/v1.0.0')).toEqual([
      'tag a/v1.0.0 is version 1.0.0 but a/swarm.json says 1.0.1',
    ]);
  });

  it('fails a tag that names a folder with no swarm', async () => {
    swarmAt('a');

    expect(await run({ [join(repo, 'a')]: ok('1.0.0') }, 'c/v1.0.0')).toEqual([
      'tag c/v1.0.0 names c, which is not a swarm in this repo',
    ]);
  });

  it('fails a tag that does not parse', async () => {
    swarmAt('a');

    expect(await run({ [join(repo, 'a')]: ok('1.0.0') }, 'nonsense')).toEqual([
      'tag nonsense is not v<x.y.z> or <folder>/v<x.y.z>',
    ]);
  });

  it('adds no version line for a swarm whose manifest is already refused', async () => {
    swarmAt('a');

    const lines = await run(
      { [join(repo, 'a')]: { manifest: null, problems: [{ field: 'name', reason: 'Bad.' }] } },
      'a/v1.0.0',
    );

    expect(lines).toEqual(['a: name: Bad.']);
  });

  it('passes a root swarm with a bare version tag', async () => {
    swarmAt('');

    expect(await run({ [repo]: ok('1.0.0') }, 'v1.0.0')).toEqual([]);
  });
});

describe('the command line', () => {
  it('still runs when invoked through a symlinked path', () => {
    const script = resolve(import.meta.dirname, '../../scripts/validate-swarm.mjs');
    const link = join(repo, 'validate-swarm.mjs');
    symlinkSync(script, link);

    const run = spawnSync(process.execPath, [link], { encoding: 'utf8' });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('usage: pnpm swarm:validate');
  });
});
