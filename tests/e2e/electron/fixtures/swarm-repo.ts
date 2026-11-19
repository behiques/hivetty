import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { swarmTag } from '../../../../shared/swarm-contract';

/**
 * A swarm's Git repository on disk, reached as `https://swarms.test/fixture.git` (HIVE-442 PR 3).
 *
 * A registry row's `repoUrl` must be `https://`, so the app cannot be pointed at a `file://` path. Git's own
 * `url.<base>.insteadOf` rewrites the URL instead, through `GIT_CONFIG_*` in the app's environment: the engine
 * spreads `process.env` into every Git it runs, so no product code knows the repository is local.
 */

export interface SwarmRelease {
  version: string;
  commit: string;
}

export interface SwarmRepo {
  url: string;
  env: Record<string, string>;
  releases: [SwarmRelease, SwarmRelease];
}

export const FIXTURE_SWARM = {
  slug: 'fixture',
  title: 'Fixture Swarm',
  description: 'One agent and one skill, for the install spec.',
  publisher: 'HiveTTY',
  agent: { name: 'fixture-helper', description: 'Helps out.', tools: ['Read', 'Bash'] },
  skill: { name: 'fixture-skill', description: 'Does the fixture thing.' },
} as const;

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    }).trim();
  } catch (cause) {
    const stderr = (cause as { stderr?: string }).stderr ?? '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim() || String(cause)}`);
  }
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function writeSwarm(work: string, version: string, body: string): void {
  const { agent, skill } = FIXTURE_SWARM;
  const manifest = {
    name: FIXTURE_SWARM.slug,
    title: FIXTURE_SWARM.title,
    description: FIXTURE_SWARM.description,
    publisher: FIXTURE_SWARM.publisher,
    version,
    tags: [],
  };
  write(join(work, 'swarm.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  write(
    join(work, 'agents', agent.name, 'AGENT.md'),
    `---\nname: ${agent.name}\ndescription: ${agent.description}\nicon: Ghost\nskills: []\ntools: [${agent.tools.join(', ')}]\n---\nWait to be asked.\n`,
  );
  write(
    join(work, 'skills', skill.name, 'SKILL.md'),
    `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${body}\n`,
  );
}

/**
 * Builds `<dir>/fixture.git` with one swarm at its root, released as `v1.0.0` and then `v1.1.0` (the second
 * changes the skill's body and the manifest's version). Throws with Git's stderr when Git fails.
 */
export function createSwarmRepo(dir: string): Promise<SwarmRepo> {
  const work = join(dir, 'work');
  const bare = join(dir, 'fixture.git');
  mkdirSync(work, { recursive: true });
  git(work, 'init', '-q');
  git(work, 'config', 'user.email', 'fixture@hivetty.test');
  git(work, 'config', 'user.name', 'Fixture');
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'tag.gpgsign', 'false');

  const versions = ['1.0.0', '1.1.0'] as const;
  for (const version of versions) {
    writeSwarm(work, version, `Version ${version} of the fixture skill.`);
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', `v${version}`);
    git(work, 'tag', swarmTag({ folder: '', version }));
  }
  git(dir, 'clone', '-q', '--bare', work, bare);
  // A native install fetches the row's commit by its hash.
  git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');

  const commitOf = (version: string): string =>
    git(bare, 'rev-list', '-n', '1', swarmTag({ folder: '', version }));

  return Promise.resolve({
    url: 'https://swarms.test/fixture.git',
    env: {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: `url.file://${dir}/.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://swarms.test/',
      GIT_CONFIG_KEY_1: 'protocol.file.allow',
      GIT_CONFIG_VALUE_1: 'always',
    },
    releases: [
      { version: versions[0], commit: commitOf(versions[0]) },
      { version: versions[1], commit: commitOf(versions[1]) },
    ],
  });
}
