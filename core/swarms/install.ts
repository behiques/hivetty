/**
 * Install a swarm (HIVE-441).
 *
 * The clone is only a source: the existing seeder copies it into `~/.hivetty`,
 * with the swarm's own seed manifest, so an installed file is upgraded, kept
 * or merged exactly as a shipped one is. Everything that can refuse runs
 * before the first write outside `<id>/repo.new`.
 *
 * A swarm that ships a name the app's built-ins own takes their manifest
 * entries over (scope from HIVE-447), so an untouched built-in upgrades and an
 * edited one stays edited. From then on that folder is the swarm's.
 */
import { lstat, mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import {
  isSwarmFolder,
  isSwarmId,
  swarmTag,
  type InstalledSwarm,
  type SwarmEntry,
  type SwarmFailure,
  type SwarmInstallResult,
} from '@shared/swarm-contract';

import { serial } from '../seed/actions';
import {
  readManifest,
  seedShipped,
  sha256,
  throughLink,
  walk,
  writeManifest,
  type Manifest,
} from '../seed/seed';

import { GitError, type SwarmGit } from './git';
import { readSwarm } from './manifest';
import { swarmPaths } from './paths';

export interface SwarmDeps {
  /** `~/.hivetty`. */
  hiveDir: string;
  /** `~/.hivetty/.seed.json`, the built-ins' manifest. */
  shippedManifest: string;
  appVersion: string;
  git: SwarmGit;
  cloneToken: (swarmId: string) => Promise<{ token: string; repoUrl: string } | SwarmFailure>;
  /** The boot seed: it writes `.seed.json` too, so every write here waits for it. */
  ready?: () => Promise<unknown>;
  seed?: typeof seedShipped;
  now?: () => Date;
}

export interface Swarms {
  installed(): Promise<InstalledSwarm[]>;
  install(entry: SwarmEntry): Promise<SwarmInstallResult>;
}

const folderOf = (rel: string): string => rel.split('/').slice(0, 2).join('/');

/** The `skills/<name>` and `agents/<name>` folders a manifest has entries under. */
export const ownedFolders = (manifest: Manifest): Set<string> =>
  new Set([...Object.keys(manifest.files), ...Object.keys(manifest.parts)].map(folderOf));

export async function readInstalled(file: string): Promise<InstalledSwarm[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(raw)) return [];
    // The two fields that become paths are checked. The rest is what this module wrote.
    return raw.filter(
      (entry): entry is InstalledSwarm =>
        typeof entry === 'object' &&
        entry !== null &&
        isSwarmId((entry as InstalledSwarm).swarmId) &&
        isSwarmFolder((entry as InstalledSwarm).folder),
    );
  } catch {
    return []; // absent or unreadable: nothing is installed
  }
}

async function writeInstalled(file: string, entries: InstalledSwarm[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(entries, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

const SEEDED_FILE = /^(?:skills|agents)\/[^/]+\/.+$/;

/**
 * Delete each file that still holds the bytes named for it, then the folders
 * that empties. A file the person edited no longer matches and stays, as theirs.
 */
export async function deleteMatching(hiveDir: string, hashes: Record<string, string>): Promise<void> {
  for (const [rel, hash] of Object.entries(hashes)) {
    // The paths come from a file on disk: only a file inside a skill or agent folder, never through `..` or a link.
    if (!SEEDED_FILE.test(rel) || rel.split('/').includes('..')) continue;
    const folder = folderOf(rel);
    if (await throughLink(hiveDir, folder)) continue;
    if (await throughLink(join(hiveDir, folder), rel.slice(folder.length + 1))) continue;

    const full = join(hiveDir, rel);
    const bytes = await readFile(full).catch(() => null);
    if (bytes === null || sha256(bytes) !== hash) continue;
    await rm(full, { force: true });

    const stop = join(hiveDir, rel.split('/')[0] ?? '');
    for (let dir = dirname(full); dir !== stop && dir.startsWith(stop + sep); dir = dirname(dir)) {
      try {
        await rmdir(dir); // refuses a folder that still holds something
      } catch {
        break;
      }
    }
  }
}

/** The swarm's own copy of every file under its folders, by hash. */
async function hashFolders(source: string, folders: string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const folder of folders) {
    const files = await walk(join(source, folder)).catch(() => [] as string[]);
    for (const file of files) {
      hashes[`${folder}/${file.split(sep).join('/')}`] = sha256(await readFile(join(source, folder, file)));
    }
  }
  return hashes;
}

function gitFailure(error: GitError, entry: SwarmEntry): SwarmFailure {
  if (error.kind === 'no_access') {
    return {
      code: 'no_access',
      message:
        entry.kind === 'organization'
          ? `HiveTTY Pro can't read ${entry.repoUrl} with your Git sign-in. Ask an Owner or Admin of ${entry.org?.name ?? entry.publisher} to give your GitHub account access to that repository, then try again.`
          : `HiveTTY Pro can't read ${entry.repoUrl}.`,
    };
  }
  if (error.kind === 'offline') {
    return { code: 'offline', message: `HiveTTY Pro can't reach ${entry.repoUrl}. Check your connection, then try again.` };
  }
  return { code: 'failed', message: error.detail };
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export function createSwarms(deps: SwarmDeps): Swarms {
  const paths = swarmPaths(deps.hiveDir);
  const seed = deps.seed ?? seedShipped;
  const now = deps.now ?? (() => new Date());

  const installNow = async (entry: SwarmEntry): Promise<SwarmInstallResult> => {
    const staging = paths.staging(entry.id);
    const before = await readInstalled(paths.installed);
    const previous = before.find((held) => held.swarmId === entry.id) ?? null;
    // Set once files may have been written for a swarm that was not installed: what takes them back out.
    let undo: (() => Promise<void>) | null = null;

    // Every step here is best effort: the failure being reported is the one that matters.
    const fail = async (failure: SwarmFailure): Promise<SwarmInstallResult> => {
      if (undo !== null) await undo().catch(() => undefined);
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (previous === null) {
        await rm(paths.dir(entry.id), { recursive: true, force: true }).catch(() => undefined);
      } else {
        const kept = before.map((held) => (held.swarmId === entry.id ? { ...held, lastError: failure } : held));
        await writeInstalled(paths.installed, kept).catch(() => undefined);
      }
      return { ok: false, failure };
    };

    try {
      // 1. Which version, and how to reach it.
      let version: string;
      let ref: string;
      if (entry.kind === 'organization') {
        const found =
          entry.policy === 'pinned'
            ? entry.pinnedVersion
            : await deps.git.newestVersion(entry.repoUrl, entry.folder);
        if (found === null) {
          return await fail({ code: 'failed', message: `${entry.repoUrl} has no released version.` });
        }
        version = found;
        ref = `refs/tags/${swarmTag({ folder: entry.folder, version })}`;
      } else {
        if (entry.version === null || entry.commit === null) {
          return await fail({ code: 'unavailable', message: `${entry.title} has no released version yet.` });
        }
        version = entry.version;
        ref = entry.commit;
      }

      let token: string | undefined;
      if (entry.access === 'token') {
        const minted = await deps.cloneToken(entry.id);
        if ('code' in minted) return await fail(minted);
        // The token goes only to the repository the registry named.
        if (minted.repoUrl !== entry.repoUrl) {
          return await fail({ code: 'failed', message: 'The cloud named a different repository for this swarm.' });
        }
        token = minted.token;
      }

      // 2. Fetch, always into a fresh folder: the installed clone is untouched until the end.
      await rm(staging, { recursive: true, force: true });
      const commit = await deps.git.fetch({ dir: staging, url: entry.repoUrl, ref, token });

      // 3. Read.
      const source = join(staging, entry.folder);
      const read = await readSwarm(source, { appVersion: deps.appVersion });
      if (read.manifest === null || read.problems.length > 0) {
        const newer = read.problems.find((problem) => problem.code === 'needs-newer-app');
        return await fail(
          newer === undefined
            ? { code: 'invalid', message: `${entry.title} is not a valid swarm.`, problems: read.problems }
            : { code: 'needs-newer-app', message: newer.reason, problems: read.problems },
        );
      }
      if (read.manifest.version !== version) {
        return await fail({
          code: 'invalid',
          message: `${entry.title} was released as ${version} but its swarm.json says ${read.manifest.version}.`,
        });
      }

      // 4. Collisions, by name, before anything is written.
      const folders = [
        ...read.contents.agents.map((agent) => `agents/${agent.name}`),
        ...read.contents.skills.map((skill) => `skills/${skill.name}`),
      ];
      const mine = await readManifest(paths.seed(entry.id));
      const shipped = await readManifest(deps.shippedManifest);
      const own = ownedFolders(mine);
      const builtIn = ownedFolders(shipped);
      const others = await Promise.all(
        before
          .filter((held) => held.swarmId !== entry.id)
          .map(async (held) => ({
            title: held.title,
            owned: ownedFolders(await readManifest(paths.seed(held.swarmId))),
          })),
      );
      const clashes: string[] = [];
      for (const folder of folders) {
        const [kind = '', name = ''] = folder.split('/');
        const noun = kind === 'agents' ? 'agent' : 'skill';
        const other = others.find((held) => held.owned.has(folder));
        if (other !== undefined) {
          clashes.push(`${read.manifest.title} and ${other.title} both provide the ${noun} ${name}.`);
          continue;
        }
        if (own.has(folder) || builtIn.has(folder)) continue;
        const exists = await lstat(join(deps.hiveDir, folder)).then(
          () => true,
          () => false,
        );
        if (exists) clashes.push(`The ${noun} ${name} already exists in ~/.hivetty/${kind} as your own.`);
      }
      if (clashes.length > 0) return await fail({ code: 'collision', message: clashes.join(' ') });

      // 5. Take over the built-ins this swarm ships: their entries move to this swarm's manifest.
      const taken = new Set(folders.filter((folder) => builtIn.has(folder)));
      if (taken.size > 0) {
        const move = <T>(from: Record<string, T>, into: Record<string, T>): Record<string, T> => {
          const stay: Record<string, T> = {};
          for (const [rel, value] of Object.entries(from)) {
            if (!taken.has(folderOf(rel))) stay[rel] = value;
            else if (!(rel in into)) into[rel] = value;
          }
          return stay;
        };
        const left: Manifest = { files: move(shipped.files, mine.files), parts: move(shipped.parts, mine.parts) };
        // The swarm's first. If only it lands, both manifests name the path: sync reads either, the boot seed
        // passes over the folder, and the next install moves nothing twice.
        await writeManifest(paths.seed(entry.id), mine);
        await writeManifest(deps.shippedManifest, left);
      }

      // 6. Seed. From here a first install that fails takes its own files back out.
      if (previous === null) {
        const hashes = await hashFolders(source, folders);
        undo = () => deleteMatching(deps.hiveDir, hashes);
      }
      await seed({ source, target: deps.hiveDir, manifestFile: paths.seed(entry.id) });

      // 7. The clone, then the entry.
      await rm(paths.repo(entry.id), { recursive: true, force: true });
      await rename(staging, paths.repo(entry.id));
      const installed: InstalledSwarm = {
        swarmId: entry.id,
        slug: entry.slug,
        kind: entry.kind,
        org: entry.org,
        repoUrl: entry.repoUrl,
        folder: entry.folder,
        version,
        commit,
        installedAt: now().toISOString(),
        autoUpdate: previous?.autoUpdate ?? entry.kind !== 'community',
        lastError: null,
        title: read.manifest.title,
        contents: read.contents,
      };
      await writeInstalled(paths.installed, [...before.filter((held) => held.swarmId !== entry.id), installed]);
      return { ok: true, installed };
    } catch (cause) {
      return fail(cause instanceof GitError ? gitFailure(cause, entry) : { code: 'failed', message: messageOf(cause) });
    }
  };

  return {
    installed: () => readInstalled(paths.installed),
    // The seed actions' own queue: reset, keep-mine and an install all write seed manifests.
    install: (entry) =>
      serial(async () => {
        await deps.ready?.();
        return installNow(entry);
      }),
  };
}
