/**
 * Adoption (HIVE-447): the built-ins a home already holds become the installed swarm Dev Squad, at the version
 * "bundled", with no network. The marker it leaves stops the boot seed for that home for good, so removing
 * Dev Squad does not bring the built-ins back. It stays after HIVE-448 for installs that skipped a release.
 */
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BUNDLED_VERSION,
  isSwarmId,
  type InstalledSwarm,
  type SwarmContents,
  type SwarmEntry,
} from '@shared/swarm-contract';

import { readManifest, writeManifest } from '../seed/seed';

import { isInstalled, ownedFolders, readInstalledRaw, takeOver, writeInstalled } from './install';
import { readAgents, readSkills } from './manifest';
import { swarmPaths } from './paths';

/** Registry ids are cuids, which hold no `-`: this one cannot be a registry's. */
export const ADOPTED_SWARM_ID = 'bundled-dev-squad';

/** The swarm the built-ins became (HIVE-448 renamed it from Standard before any release carried it). */
export const DEV_SQUAD = {
  slug: 'dev-squad',
  kind: 'native',
  org: null,
  title: 'Dev Squad',
  description: 'Ticket to merge: plan, build, review, ship.',
  repoUrl: 'https://github.com/behiques/hivetty-swarms.git',
  folder: 'dev-squad',
  commit: 'e0fec8c5b2bd8b489132744eeac00aa456541e56',
} as const;

export interface AdoptDeps {
  /** `~/.hivetty`. */
  hiveDir: string;
  /** `~/.hivetty/.seed.json`. */
  shippedManifest: string;
  now?: () => Date;
}

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

const isDevSquad = (held: InstalledSwarm): boolean => held.kind === DEV_SQUAD.kind && held.slug === DEV_SQUAD.slug;

/** What is on disk for the adopted folders. A file the reader refuses still counts, by name. */
async function contentsOf(hiveDir: string, present: readonly string[]): Promise<SwarmContents> {
  const namesOf = (kind: string): string[] =>
    present.filter((folder) => folder.startsWith(`${kind}/`)).map((folder) => folder.slice(kind.length + 1));
  const skills = await readSkills(hiveDir, []).catch(() => []);
  const agents = await readAgents(
    hiveDir,
    skills.map((skill) => skill.name),
    [],
  ).catch(() => []);
  return {
    agents: namesOf('agents').map(
      (name) => agents.find((agent) => agent.name === name) ?? { name, description: '', tools: [] },
    ),
    skills: namesOf('skills').map((name) => skills.find((skill) => skill.name === name) ?? { name, description: '' }),
  };
}

/** Throws when a read or a write fails: the caller logs it, and the next launch tries again. */
export async function adoptBuiltIns(deps: AdoptDeps): Promise<void> {
  const paths = swarmPaths(deps.hiveDir);
  if (await exists(paths.adopted)) return;

  // Missing or malformed reads as empty: nothing to adopt, and the marker is all this home needs.
  const shipped = await readManifest(deps.shippedManifest);
  const owned = ownedFolders(shipped);
  const present: string[] = [];
  for (const folder of [...owned].sort()) {
    if (await exists(join(deps.hiveDir, folder))) present.push(folder);
  }

  if (present.length > 0) {
    // Unreadable throws: nothing is written, no marker, and the next launch tries again.
    const raw = await readInstalledRaw(paths.installed);
    let target = raw.filter(isInstalled).find(isDevSquad) ?? null;
    if (target === null) {
      target = {
        swarmId: ADOPTED_SWARM_ID,
        ...DEV_SQUAD,
        version: BUNDLED_VERSION,
        installedAt: (deps.now ?? (() => new Date()))().toISOString(),
        autoUpdate: true,
        lastError: null,
        contents: await contentsOf(deps.hiveDir, present),
      };
      // The entry first. If only it lands, the next run finds it as the target and finishes the takeover.
      await writeInstalled(paths.installed, [...raw, target]);
    }
    const mineFile = paths.seed(target.swarmId);
    // The swarm's manifest, then `.seed.json`. If only the first lands, both name the files: the boot seed
    // passes over them, and the next run moves nothing twice.
    await takeOver(deps.shippedManifest, shipped, mineFile, await readManifest(mineFile), owned);
  } else if (owned.size > 0) {
    // Every built-in was deleted. With the marker the boot seed never runs again, so "seeded once, gone now"
    // has nothing left to protect, and a later install must create the files.
    await writeManifest(deps.shippedManifest, { files: {}, parts: {} });
  }

  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.adopted, ''); // last: only a finished adoption stops the boot seed
}

/** The registry's Dev Squad row, when its id can become a folder and is not the local one. */
function devSquadRow(rows: readonly SwarmEntry[]): SwarmEntry | null {
  const row = rows.find((one) => one.kind === DEV_SQUAD.kind && one.slug === DEV_SQUAD.slug);
  return row === undefined || !isSwarmId(row.id) || row.id === ADOPTED_SWARM_ID ? null : row;
}

/**
 * The registry's Dev Squad row when an adopted entry waits to take its id, else null. Pure, so a caller can ask
 * before it queues anything.
 */
export function rekeyTarget(rows: readonly SwarmEntry[], held: readonly InstalledSwarm[]): SwarmEntry | null {
  const row = devSquadRow(rows);
  if (row === null) return null;
  if (!held.some((one) => one.swarmId === ADOPTED_SWARM_ID) || held.some((one) => one.swarmId === row.id)) return null;
  return row;
}

/**
 * The registry named Dev Squad: the adopted entry takes the registry's id, so install, update and the listing
 * match it by id like any other swarm. Each step tolerates having already run.
 */
export async function rekeyAdopted(hiveDir: string, rows: readonly SwarmEntry[]): Promise<boolean> {
  if (devSquadRow(rows) === null) return false;
  const paths = swarmPaths(hiveDir);
  let raw: unknown[];
  try {
    raw = await readInstalledRaw(paths.installed);
  } catch {
    return false; // unreadable: a writer refuses, and the next read tries again
  }
  const row = rekeyTarget(rows, raw.filter(isInstalled));
  if (row === null) return false;
  await mkdir(paths.dir(row.id), { recursive: true });
  // The manifest first. If only it moves, the entry still says `bundled-dev-squad`: the boot seed reads every
  // folder's manifest whatever installed.json says, and the next call finds nothing to move and finishes.
  await rename(paths.seed(ADOPTED_SWARM_ID), paths.seed(row.id)).catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  });
  await rm(paths.dir(ADOPTED_SWARM_ID), { recursive: true, force: true });
  await writeInstalled(
    paths.installed,
    raw.map((one) => (isInstalled(one) && one.swarmId === ADOPTED_SWARM_ID ? { ...one, swarmId: row.id } : one)),
  );
  return true;
}
