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
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';

import {
  isBundled,
  isSwarmFolder,
  isSwarmId,
  swarmTag,
  type InstalledSwarm,
  type SwarmEntry,
  type SwarmFailure,
  type SwarmInstallResult,
  type SwarmListing,
  type SwarmRemoveResult,
  type SwarmUpdate,
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
  type SeedOptions,
} from '../seed/seed';

import { GitError, type SwarmGit } from './git';
import { readSwarm } from './manifest';
import { swarmPaths } from './paths';
import type { RegistryRead } from './registry';

export interface SwarmDeps {
  /** `~/.hivetty`. */
  hiveDir: string;
  /** `~/.hivetty/.seed.json`, the built-ins' manifest. */
  shippedManifest: string;
  appVersion: string;
  git: SwarmGit;
  cloneToken: (swarmId: string) => Promise<{ token: string; repoUrl: string } | SwarmFailure>;
  /** Boot's adoption: it writes `.seed.json` and installed.json too, so every write here waits for it. */
  ready?: () => Promise<unknown>;
  seed?: typeof seedShipped;
  now?: () => Date;
}

export interface Swarms {
  installed(): Promise<InstalledSwarm[]>;
  install(entry: SwarmEntry): Promise<SwarmInstallResult>;
  /**
   * HIVE-442: `install`, asking `onlyIf` first with the entry installed when the install's turn in the queue comes.
   * False installs nothing and answers null: a removal or a switch turned off while it waited wins.
   */
  installIf(entry: SwarmEntry, onlyIf: (previous: InstalledSwarm | null) => boolean): Promise<SwarmInstallResult | null>;
  remove(swarmId: string): Promise<SwarmRemoveResult>;
  /** HIVE-442: the row's "Update automatically" switch. Null when the swarm is not installed or the list cannot be written. */
  setAutoUpdate(swarmId: string, autoUpdate: boolean): Promise<InstalledSwarm | null>;
  /**
   * One set per installed swarm (HIVE-448: the app ships none of its own). An entry still at the version `bundled`
   * has no clone to read its files against, so it has no set until its first update installs a real version.
   */
  seedSets(): Promise<SeedOptions[]>;
  /** The set of the swarm that owns `<kind>/<name>`, or null: a file no swarm owns is the person's own. */
  seedSetFor(folder: string): Promise<SeedOptions | null>;
  /**
   * Every swarm's seed manifest and pending first install on disk, whatever installed.json says: a file any of them
   * names was written by a swarm, so settings sync and the shipped seed leave it alone.
   */
  manifestFiles(): Promise<string[]>;
}

const folderOf = (rel: string): string => rel.split('/').slice(0, 2).join('/');

/** The `skills/<name>` and `agents/<name>` folders a manifest has entries under. */
export const ownedFolders = (manifest: Manifest): Set<string> =>
  new Set([...Object.keys(manifest.files), ...Object.keys(manifest.parts)].map(folderOf));

// The two fields that become paths are checked. The rest is what this module wrote.
export const isInstalled = (entry: unknown): entry is InstalledSwarm =>
  typeof entry === 'object' &&
  entry !== null &&
  isSwarmId((entry as InstalledSwarm).swarmId) &&
  isSwarmFolder((entry as InstalledSwarm).folder);

const isEntryOf = (entry: unknown, swarmId: string): boolean => isInstalled(entry) && entry.swarmId === swarmId;

/**
 * Every entry as written, the ones `isInstalled` refuses included, for a write that puts the list back. Absent is
 * nothing installed; unreadable throws, so an install or a removal never overwrites the other swarms' entries.
 */
export async function readInstalledRaw(file: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('not a list');
  return raw;
}

const unreadable = (hiveDir: string, cause: unknown): SwarmFailure => ({
  code: 'failed',
  message: `~/${basename(hiveDir)}/swarms/installed.json can't be read (${messageOf(cause)}), so HiveTTY Pro changed nothing.`,
});

export async function readInstalled(file: string): Promise<InstalledSwarm[]> {
  try {
    return (await readInstalledRaw(file)).filter(isInstalled);
  } catch {
    return []; // unreadable: a reader sees nothing installed, and only a writer refuses
  }
}

export async function writeInstalled(file: string, entries: unknown[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(entries, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

/** A first install's file hashes, written before it seeds: what a retry adopts, or takes back out, if the app died. */
async function readPending(file: string): Promise<Record<string, string>> {
  try {
    let raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    // Written as a seed manifest's `{ files }`, so sync reads it as one; an older build wrote the bare map.
    const files: unknown = (raw as { files?: unknown }).files;
    if (typeof files === 'object' && files !== null && !Array.isArray(files)) raw = files;
    return Object.fromEntries(Object.entries(raw as object).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  } catch {
    return {};
  }
}

/** Whether every file under `folder` holds the bytes a dead first install wrote there. */
async function onlyLeftover(hiveDir: string, folder: string, leftover: Record<string, string>): Promise<boolean> {
  if (await throughLink(hiveDir, folder)) return false;
  const files = await walk(join(hiveDir, folder));
  if (files.length === 0) return false;
  for (const file of files) {
    const rel = `${folder}/${file}`;
    if (leftover[rel] === undefined || sha256(await readFile(join(hiveDir, rel))) !== leftover[rel]) return false;
  }
  return true;
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

/**
 * A first install that failed after its takeover deletes `<id>/`, and the moved entries with it. They go back to
 * `.seed.json`, except for a file the undo deleted: an entry would read as the person having deleted it, and since
 * HIVE-448 nothing seeds it back.
 */
async function giveBackTaken(
  hiveDir: string,
  shippedManifest: string,
  original: Manifest,
  taken: ReadonlySet<string>,
): Promise<void> {
  const current = await readManifest(shippedManifest);
  const kept = async <T>(from: Record<string, T>, into: Record<string, T>): Promise<void> => {
    for (const [rel, value] of Object.entries(from)) {
      if (!taken.has(folderOf(rel))) continue;
      const present = await lstat(join(hiveDir, rel)).then(
        () => true,
        () => false,
      );
      if (present) into[rel] = value;
    }
  };
  await kept(original.files, current.files);
  await kept(original.parts, current.parts);
  await writeManifest(shippedManifest, current);
}

/**
 * Move every entry of `shipped` under a `taken` folder into `mine` (an entry `mine` already has is kept), then write
 * `mineFile` and, after it, `shippedFile` without the moved entries. If only the first write lands, both manifests
 * name the path: sync reads either, nothing seeds at boot to rewrite it, and the next call moves nothing twice.
 * Mutates `mine`.
 */
export async function takeOver(
  shippedFile: string,
  shipped: Manifest,
  mineFile: string,
  mine: Manifest,
  taken: ReadonlySet<string>,
): Promise<void> {
  const move = <T>(from: Record<string, T>, into: Record<string, T>): Record<string, T> => {
    const stay: Record<string, T> = {};
    for (const [rel, value] of Object.entries(from)) {
      if (!taken.has(folderOf(rel))) stay[rel] = value;
      else if (!(rel in into)) into[rel] = value;
    }
    return stay;
  };
  const left: Manifest = { files: move(shipped.files, mine.files), parts: move(shipped.parts, mine.parts) };
  await writeManifest(mineFile, mine);
  await writeManifest(shippedFile, left);
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

  const installNow = async (
    entry: SwarmEntry,
    onlyIf: (previous: InstalledSwarm | null) => boolean = () => true,
  ): Promise<SwarmInstallResult | null> => {
    // The id becomes a path, and `swarmPaths` throws on a bad one: refused here, so install never rejects.
    if (!isSwarmId(entry.id)) return { ok: false, failure: { code: 'failed', message: 'Not a swarm id.' } };
    const staging = paths.staging(entry.id);
    let raw: unknown[];
    try {
      raw = await readInstalledRaw(paths.installed);
    } catch (cause) {
      return { ok: false, failure: unreadable(deps.hiveDir, cause) };
    }
    const before = raw.filter(isInstalled);
    const previous = before.find((held) => held.swarmId === entry.id) ?? null;
    if (!onlyIf(previous)) return null;
    // What a first install the app died in the middle of left behind: adopted when untouched, else taken back out.
    const leftover = previous === null ? await readPending(paths.pending(entry.id)) : {};
    // Set once files may have been written for a swarm that was not installed: what takes them back out.
    let undo: (() => Promise<void>) | null =
      Object.keys(leftover).length > 0 ? () => deleteMatching(deps.hiveDir, leftover) : null;
    // Set once a first install has moved built-ins' entries out of `.seed.json`: what puts them back.
    let giveBack: (() => Promise<void>) | null = null;

    // Every step here is best effort: the failure being reported is the one that matters.
    const fail = async (failure: SwarmFailure): Promise<SwarmInstallResult> => {
      if (undo !== null) await undo().catch(() => undefined);
      if (giveBack !== null) await giveBack().catch(() => undefined);
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (previous === null) {
        await rm(paths.dir(entry.id), { recursive: true, force: true }).catch(() => undefined);
      } else {
        const kept = raw.map((held) =>
          isEntryOf(held, entry.id) ? { ...(held as InstalledSwarm), lastError: failure } : held,
        );
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
      const claimed = new Set<string>();
      // Files already on disk under a claimed folder: a failed first install never takes them out, even when they
      // hold the swarm's exact bytes.
      const theirs = new Set<string>();
      for (const folder of folders) {
        const [kind = '', name = ''] = folder.split('/');
        const noun = kind === 'agents' ? 'agent' : 'skill';
        const other = others.find((held) => held.owned.has(folder));
        if (other !== undefined) {
          clashes.push(`${read.manifest.title} and ${other.title} both provide the ${noun} ${name}.`);
          continue;
        }
        if (own.has(folder) || builtIn.has(folder)) continue;
        if (await onlyLeftover(deps.hiveDir, folder, leftover)) continue;
        const exists = await lstat(join(deps.hiveDir, folder)).then(
          () => true,
          () => false,
        );
        // The person's own: kept, and recorded as an edited file of this swarm when the seed runs (HIVE-447).
        if (exists) {
          claimed.add(folder);
          for (const file of await walk(join(deps.hiveDir, folder))) theirs.add(`${folder}/${file}`);
        }
      }
      if (clashes.length > 0) return await fail({ code: 'collision', message: clashes.join(' ') });

      // 5. Take over the built-ins this swarm ships: their entries move to this swarm's manifest.
      const taken = new Set(folders.filter((folder) => builtIn.has(folder)));
      if (taken.size > 0) {
        // Set before the writes: `giveBackTaken` only restores entries `.seed.json` lacks whose file is on disk.
        if (previous === null) giveBack = () => giveBackTaken(deps.hiveDir, deps.shippedManifest, shipped, taken);
        await takeOver(deps.shippedManifest, shipped, paths.seed(entry.id), mine, taken);
      }

      // 6. Seed. From here a first install that fails takes its own files back out.
      if (previous === null) {
        const hashes = Object.fromEntries(
          Object.entries({ ...leftover, ...(await hashFolders(source, folders)) }).filter(([rel]) => !theirs.has(rel)),
        );
        await mkdir(paths.dir(entry.id), { recursive: true });
        await writeFile(paths.pending(entry.id), `${JSON.stringify({ files: hashes, parts: {} })}\n`);
        undo = () => deleteMatching(deps.hiveDir, hashes);
      }
      await seed({ source, target: deps.hiveDir, manifestFile: paths.seed(entry.id), claim: claimed });

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
        description: read.manifest.description,
        contents: read.contents,
        disabled: { agents: [], skills: [] },
      };
      await writeInstalled(paths.installed, [...raw.filter((held) => !isEntryOf(held, entry.id)), installed]);
      await rm(paths.pending(entry.id), { force: true });
      return { ok: true, installed };
    } catch (cause) {
      return fail(cause instanceof GitError ? gitFailure(cause, entry) : { code: 'failed', message: messageOf(cause) });
    }
  };

  const removeNow = async (swarmId: string): Promise<SwarmRemoveResult> => {
    if (!isSwarmId(swarmId)) return { ok: false, failure: { code: 'failed', message: 'Not a swarm id.' } };
    let raw: unknown[];
    try {
      raw = await readInstalledRaw(paths.installed);
    } catch (cause) {
      return { ok: false, failure: unreadable(deps.hiveDir, cause) };
    }
    try {
      const manifest = await readManifest(paths.seed(swarmId));
      // Files first, then the record of them: a removal cut short still knows what it owned, and removing again finishes it.
      await deleteMatching(deps.hiveDir, manifest.files);
      await rm(paths.dir(swarmId), { recursive: true, force: true });
      await writeInstalled(paths.installed, raw.filter((held) => !isEntryOf(held, swarmId)));
      return { ok: true };
    } catch (cause) {
      return { ok: false, failure: { code: 'failed', message: messageOf(cause) } };
    }
  };

  const setAutoUpdateNow = async (swarmId: string, autoUpdate: boolean): Promise<InstalledSwarm | null> => {
    if (!isSwarmId(swarmId)) return null;
    try {
      const raw = await readInstalledRaw(paths.installed); // throws when unreadable: nothing is overwritten
      const held = raw.find((row) => isEntryOf(row, swarmId));
      if (!isInstalled(held)) return null;
      const next: InstalledSwarm = { ...held, autoUpdate };
      // Every other row, the ones `isInstalled` refuses included, goes back as it was read. Tmp file then rename.
      await writeInstalled(paths.installed, raw.map((row) => (row === held ? next : row)));
      return next;
    } catch {
      return null;
    }
  };

  // Read from the folders, not installed.json: a first install seeds before its entry is written, and an unreadable
  // installed.json must not turn a swarm's files into the person's own.
  const manifestFiles = async (): Promise<string[]> => {
    const listed = await readdir(paths.root, { withFileTypes: true }).catch(() => []);
    return listed
      .filter((dirent) => dirent.isDirectory() && isSwarmId(dirent.name))
      .map((dirent) => dirent.name)
      .sort()
      .flatMap((id) => [paths.seed(id), paths.pending(id)]);
  };

  const seedSets = async (): Promise<SeedOptions[]> =>
    (await readInstalled(paths.installed))
      // HIVE-447: an adopted Dev Squad has no clone until its first update, and HIVE-448 left no shipped tree to read it against.
      .filter((held) => !isBundled(held.version))
      .map((held) => ({
        source: join(paths.repo(held.swarmId), held.folder),
        target: deps.hiveDir,
        manifestFile: paths.seed(held.swarmId),
      }));

  return {
    installed: () => readInstalled(paths.installed),
    // The seed actions' own queue: reset, keep-mine and an install all write seed manifests.
    install: (entry) =>
      serial(async () => {
        await deps.ready?.();
        // Without a guard nothing refuses: never null.
        return (await installNow(entry)) as SwarmInstallResult;
      }),
    installIf: (entry, onlyIf) =>
      serial(async () => {
        await deps.ready?.();
        return installNow(entry, onlyIf);
      }),
    remove: (swarmId) =>
      serial(async () => {
        await deps.ready?.();
        return removeNow(swarmId);
      }),
    // The same queue: an install writes installed.json too.
    setAutoUpdate: (swarmId, autoUpdate) =>
      serial(async () => {
        await deps.ready?.();
        return setAutoUpdateNow(swarmId, autoUpdate);
      }),
    seedSets,
    manifestFiles,
    seedSetFor: async (folder) => {
      for (const set of await seedSets()) {
        if (ownedFolders(await readManifest(set.manifestFile)).has(folder)) return set;
      }
      return null;
    },
  };
}

/**
 * Registry rows first, each with its installed entry; then installed swarms the registry did not return. Each
 * installed swarm carries the updater's pending update (HIVE-442).
 */
export function mergeListing(
  registry: RegistryRead,
  installed: InstalledSwarm[],
  pending: (swarmId: string) => SwarmUpdate | null = () => null,
): SwarmListing {
  const held = new Map(installed.map((entry) => [entry.swarmId, entry]));
  const listed = new Set(registry.swarms.map((entry) => entry.id));
  return {
    source: registry.source,
    items: [
      ...registry.swarms.map((entry) => {
        const mine = held.get(entry.id) ?? null;
        return { entry, installed: mine, update: mine === null ? null : pending(entry.id), missing: { agents: [], skills: [] } };
      }),
      ...installed
        .filter((entry) => !listed.has(entry.swarmId))
        .map((entry) => ({ entry: null, installed: entry, update: pending(entry.swarmId), missing: { agents: [], skills: [] } })),
    ],
  };
}
