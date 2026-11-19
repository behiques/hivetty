/**
 * `pnpm swarm:pull <tag>`: bring a tagged Standard swarm into `resources/` (HIVE-439).
 *
 * The Standard swarm's source of truth is `behiques/hivetty-swarms`. Until the
 * app stops shipping agents and skills (HIVE-448), this command is the only way
 * `resources/agents` and `resources/skills` change: it copies a tag in and
 * records it in `resources/swarm.lock.json`, a sha256 per file.
 * `tests/resources/swarm-lock.test.ts` recomputes those hashes, so a hand edit
 * fails `pnpm test`.
 *
 * `.mjs` like every script here. The reader it validates with is TypeScript,
 * loaded by `loadSwarmModules` in `validate-swarm.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SWARM_REPO = 'behiques/hivetty-swarms';
export const LOCK_FILE = 'swarm.lock.json';

const KINDS = ['agents', 'skills'];

/** sha256 of every file under `agents/` and `skills/`, keyed by POSIX path, sorted. */
export function hashTree(resourcesDir) {
  /** @type {[string, string][]} */
  const files = [];

  const walk = (rel) => {
    let listing;
    try {
      listing = readdirSync(join(resourcesDir, rel), { withFileTypes: true });
    } catch {
      return; // No folder of this kind.
    }

    for (const entry of listing) {
      // Finder writes these into any folder it opens; they are in no tag.
      if (entry.name === '.DS_Store') continue;

      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else files.push([path, createHash('sha256').update(readFileSync(join(resourcesDir, path))).digest('hex')]);
    }
  };

  for (const kind of KINDS) walk(kind);

  return Object.fromEntries(files.sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The lock under `resourcesDir`; a missing or unreadable one throws naming the command that writes it. */
export function readLock(resourcesDir) {
  try {
    return JSON.parse(readFileSync(join(resourcesDir, LOCK_FILE), 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${LOCK_FILE} cannot be read (${reason}). Run pnpm swarm:pull <tag>, like standard/v1.0.0.`);
  }
}

export async function pullSwarm({ tag, repoUrl, resourcesDir, readSwarm, parseSwarmTag }) {
  const parsed = parseSwarmTag(tag);
  if (parsed === null) throw new Error(`${tag} is not v<x.y.z> or <folder>/v<x.y.z>.`);
  // The lock is a copy of the Standard swarm, and the drift test refuses any other folder.
  if (parsed.folder !== 'standard') throw new Error(`${tag} is not a standard/ tag, like standard/v1.0.0.`);

  const clone = mkdtempSync(join(tmpdir(), 'hive-swarm-pull-'));

  try {
    const git = (...args) =>
      execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // Fail at once on a missing credential; never wait for input.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }).trim();

    // Throws with Git's own message on no access or no such tag. Nothing is written yet.
    git('clone', '--quiet', '--depth', '1', '--branch', tag, repoUrl, clone);
    const commit = git('-C', clone, 'rev-parse', 'HEAD');

    const source = join(clone, parsed.folder);
    const read = await readSwarm(source);

    if (read.problems.length > 0) {
      const lines = read.problems.map((problem) => `  ${problem.field || 'swarm'}: ${problem.reason}`);
      throw new Error(`${tag} is not a valid swarm:\n${lines.join('\n')}`);
    }
    if (read.manifest?.version !== parsed.version) {
      throw new Error(`${tag} is version ${parsed.version} but its swarm.json says ${String(read.manifest?.version)}.`);
    }

    // Two writes: the folders, then the lock. The lock goes last, so a pull
    // that dies between them leaves a tree the drift test refuses, never a
    // lock vouching for files it did not write. Running the pull again
    // repairs both.
    for (const kind of KINDS) {
      rmSync(join(resourcesDir, kind), { recursive: true, force: true });
      if (existsSync(join(source, kind))) cpSync(join(source, kind), join(resourcesDir, kind), { recursive: true });
    }

    const lock = { repo: SWARM_REPO, tag, commit, files: hashTree(resourcesDir) };
    writeFileSync(join(resourcesDir, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);

    return lock;
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

// Node realpaths the main module's URL but not argv[1], so a symlinked path compares real to real.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];

  if (tag === undefined) {
    console.error('usage: pnpm swarm:pull <tag>, like standard/v1.0.0');
    process.exit(1);
  }

  const { loadSwarmModules } = await import('./validate-swarm.mjs');
  const { readSwarm, parseSwarmTag } = await loadSwarmModules();

  try {
    const lock = await pullSwarm({
      tag,
      repoUrl: process.env.HIVE_SWARMS_REPO ?? `git@github.com:${SWARM_REPO}.git`,
      resourcesDir: join(import.meta.dirname, '..', 'resources'),
      readSwarm,
      parseSwarmTag,
    });
    console.info(`swarm:pull: ${tag} at ${lock.commit.slice(0, 8)}, ${String(Object.keys(lock.files).length)} files`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
