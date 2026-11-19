/**
 * Adoption (HIVE-447): the built-ins a home already holds become the installed swarm Standard, at the version
 * "bundled", with no network. The marker it leaves stops the boot seed for that home for good, so removing
 * Standard does not bring the built-ins back. It stays after HIVE-448 for installs that skipped a release.
 */
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BUNDLED_VERSION, type InstalledSwarm, type SwarmContents } from '@shared/swarm-contract';

import { readManifest, writeManifest } from '../seed/seed';

import { isInstalled, ownedFolders, readInstalledRaw, takeOver, writeInstalled } from './install';
import { readAgents, readSkills } from './manifest';
import { swarmPaths } from './paths';

/** Registry ids are cuids, which hold no `-`: this one cannot be a registry's. */
export const ADOPTED_SWARM_ID = 'bundled-standard';

/** What the app shipped as built-ins. Constants, not `resources/swarm.lock.json`: HIVE-448 deletes the lock. */
export const STANDARD = {
  slug: 'standard',
  kind: 'native',
  org: null,
  title: 'Standard',
  description: 'Ticket to merge: plan, build, review, ship.',
  repoUrl: 'https://github.com/behiques/hivetty-swarms.git',
  folder: 'standard',
  commit: '97c5d2dfde58f021dba3c9222ba6fcd8e1033996',
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

const isStandard = (held: InstalledSwarm): boolean => held.kind === STANDARD.kind && held.slug === STANDARD.slug;

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
    let target = raw.filter(isInstalled).find(isStandard) ?? null;
    if (target === null) {
      target = {
        swarmId: ADOPTED_SWARM_ID,
        ...STANDARD,
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
