/**
 * The app's swarms (HIVE-441): one engine over `~/.hivetty`, the calls the
 * renderer may make, and the updater that keeps installed swarms current (HIVE-442).
 *
 * The cloud session, the session environment and the "skills changed" hooks
 * arrive through `setSwarmHooks`, as settings sync's do, so this folder
 * depends on neither the licence client nor the IPC layer.
 */
import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  isBundled,
  parseSwarmAutoUpdateRequest,
  parseSwarmRequest,
  type InstalledSwarm,
  type SwarmEntry,
  type SwarmInstallResult,
  type SwarmListing,
  type SwarmRemoveResult,
  type SwarmsChanged,
  isSwarmId,
} from '@shared/swarm-contract';

import { configPath } from '../config/paths';
import { platform } from '../platform';
import { shippedOptions } from '../seed';
import { serial } from '../seed/actions';
import type { SeedOptions } from '../seed/seed';

import { adoptBuiltIns, rekeyAdopted, rekeyTarget } from './adopt';
import { createSwarmGit, type SwarmGit } from './git';
import { createSwarms, mergeListing, type Swarms } from './install';
import { swarmPaths } from './paths';
import { cloneToken, readRegistry, type AuthedFetch, type RegistryRead } from './registry';
import { reportFor, reportInstall } from './report';
import { createSwarmUpdater, type SwarmUpdater } from './update';

export interface SwarmHooks {
  /** The boot seed. Never rejects. */
  ready: () => Promise<unknown>;
  afterSkills: () => void;
  afterAgents: () => void;
  /** What Git runs in: the environment sessions get. */
  env: () => NodeJS.ProcessEnv;
  /** The signed-in cloud client's fetch, or null before there is one. */
  authedFetch: () => AuthedFetch | null;
  /** HIVE-442: whether an agent run is live. An automatic update waits for none to be. */
  runsLive: () => boolean;
  /** HIVE-442: the list changed on this machine; `updated` names an install that replaced an older version. */
  changed: (event: SwarmsChanged) => void;
  /** HIVE-442: an update was applied with nobody asking. */
  notify: (updated: { swarmId: string; title: string; version: string }) => void;
  /** HIVE-442: an install link arrived; tell the renderer to take it. */
  installRequested: () => void;
}

const NO_HOOKS: SwarmHooks = {
  ready: () => Promise.resolve(),
  afterSkills: () => undefined,
  afterAgents: () => undefined,
  env: () => process.env,
  authedFetch: () => null,
  runsLive: () => false,
  changed: () => undefined,
  notify: () => undefined,
  installRequested: () => undefined,
};

let hooks: SwarmHooks = NO_HOOKS;
let engine: Swarms | null = null;
let updates: SwarmUpdater | null = null;
let gitClient: SwarmGit | null = null;
let hadSession = false;
let installRequest: string | null = null;

export function setSwarmHooks(next: SwarmHooks): void {
  hooks = next;
}

const hiveDir = (): string => dirname(configPath());

// Read through `hooks` at call time: the hooks are set after the first caller asks for the engine.
const git = (): SwarmGit =>
  (gitClient ??= createSwarmGit({ env: () => hooks.env(), askpass: swarmPaths(hiveDir()).askpass }));

function swarms(): Swarms {
  engine ??= createSwarms({
    hiveDir: hiveDir(),
    shippedManifest: shippedOptions().manifestFile,
    appVersion: platform().lifecycle.version,
    git: git(),
    cloneToken: (swarmId) => cloneToken(hooks.authedFetch(), swarmId),
    ready: () => hooks.ready(),
  });
  return engine;
}

const registry = async (): Promise<RegistryRead> => {
  const read = await readRegistry(hooks.authedFetch(), swarmPaths(hiveDir()).registry);
  // HIVE-447: the adopted Standard takes the registry's id, in the install queue and after the boot seed. Never the
  // reason a read fails. No caller reads the registry from inside the queue, so this never waits on itself. Asked
  // first outside the queue, so a read with nothing to re-key never waits behind an install's clone.
  if (rekeyTarget(read.swarms, await swarms().installed()) === null) return read; // installed() never rejects
  await serial(async () => {
    await hooks.ready();
    await rekeyAdopted(hiveDir(), read.swarms);
  }).catch(() => undefined);
  return read;
};

// Whether it worked or not: a failed update may have changed files before it failed.
const refresh = (): void => {
  hooks.afterSkills();
  hooks.afterAgents();
};

const installedOne = async (swarmId: string): Promise<InstalledSwarm | null> =>
  (await swarms().installed()).find((held) => held.swarmId === swarmId) ?? null; // never rejects: unreadable reads as nothing

/**
 * The one install path (HIVE-442): a click and the updater both end here, so both report and both tell the renderer.
 * What it replaced is read inside the install queue, so an automatic update that landed while a click waited is not
 * named as this install's. `onlyIf` false installs nothing, reports nothing and answers null.
 */
async function applyInstall(
  entry: SwarmEntry,
  onlyIf: (installed: InstalledSwarm | null) => boolean = () => true,
): Promise<SwarmInstallResult | null> {
  const seen: { before: InstalledSwarm | null } = { before: null };
  const result = await swarms().installIf(entry, (previous) => {
    seen.before = previous;
    return onlyIf(previous);
  }); // never rejects
  if (result === null) return null;
  const { before } = seen;
  if (result.ok) updater().clear(entry.id);
  const report = reportFor(entry, result);
  if (report !== null) void reportInstall(hooks.authedFetch(), entry.id, report); // never rejects, never awaited
  refresh();
  const replaced = result.ok && before !== null && before.version !== result.installed.version;
  hooks.changed({
    updated: replaced
      ? { swarmId: entry.id, title: result.installed.title, version: result.installed.version }
      : null,
  });
  return result;
}

function updater(): SwarmUpdater {
  updates ??= createSwarmUpdater({
    registry,
    installed: () => swarms().installed(),
    newestVersion: (repoUrl, folder) => git().newestVersion(repoUrl, folder),
    apply: applyInstall,
    runsLive: () => hooks.runsLive(),
    changed: () => hooks.changed({ updated: null }),
    notify: (updated) => hooks.notify(updated),
  });
  return updates;
}

export interface SwarmCalls {
  list(): Promise<SwarmListing>;
  install(payload: unknown): Promise<SwarmInstallResult>;
  remove(payload: unknown): Promise<SwarmRemoveResult>;
  setAutoUpdate(payload: unknown): Promise<InstalledSwarm | null>;
  check(): Promise<SwarmListing>;
}

export function swarmCalls(): SwarmCalls {
  const list = async (): Promise<SwarmListing> =>
    mergeListing(await registry(), await swarms().installed(), (swarmId) => updater().pending(swarmId));

  return {
    list,
    install: async (payload) => {
      const { swarmId } = parseSwarmRequest(payload);
      // The row comes from the registry, never from the caller: a renderer cannot name a repository.
      const entry = (await registry()).swarms.find((row) => row.id === swarmId);
      if (entry === undefined) {
        return { ok: false, failure: { code: 'unavailable', message: "This swarm isn't available to your account." } };
      }
      // Nothing refuses a click: never null.
      return (await applyInstall(entry)) as SwarmInstallResult;
    },
    remove: async (payload) => {
      const { swarmId } = parseSwarmRequest(payload);
      const before = await installedOne(swarmId);
      const result = await swarms().remove(swarmId); // never rejects
      if (result.ok) {
        updater().clear(swarmId);
        // A bundled Standard was never reported as installed (HIVE-447).
        if (before !== null && !isBundled(before.version)) {
          void reportInstall(hooks.authedFetch(), swarmId, { state: 'removed', version: before.version });
        }
      }
      refresh();
      hooks.changed({ updated: null });
      return result;
    },
    setAutoUpdate: async (payload) => {
      const { swarmId, autoUpdate } = parseSwarmAutoUpdateRequest(payload);
      const result = await swarms().setAutoUpdate(swarmId, autoUpdate); // null when it could not be written
      void updater().check(); // a switch turned on applies what was waiting
      return result;
    },
    check: async () => {
      await updater().check(); // never rejects
      return list();
    },
  };
}

/** Starts the six-hour check. The answer stops it. */
export function startSwarmUpdates(): () => void {
  updater().start();
  return () => updater().stop();
}

/** The last agent run ended. */
export function swarmRunsIdle(): void {
  void updater().idle();
}

/** The licence or the account moved: check once each time a cloud session appears. */
export function swarmSessionChanged(): void {
  const has = hooks.authedFetch() !== null;
  if (has && !hadSession) void updater().check();
  hadSession = has;
}

/** The shipped seed options, minus the folders swarms own, and one set per installed swarm. */
export const swarmSeedSets = (): Promise<{ shipped: SeedOptions; swarms: SeedOptions[] }> =>
  swarms().seedSets(shippedOptions());

/**
 * The boot seed, then adoption (HIVE-447). Once a home is adopted the seed from `resources/` never runs there
 * again. This is the promise every install, removal and seed action waits for (`hooks.ready`), so adoption runs
 * here and never in their queue: queued behind them it would wait on itself. Never rejects.
 *
 * `seed` answers null for a seed that failed, as `seedShippedIntoHive` does: no adoption and no marker then, so a
 * home whose seed failed is seeded again at the next launch.
 */
export async function seedAndAdopt(seed: (exclude: ReadonlySet<string> | undefined) => Promise<unknown>): Promise<void> {
  const dir = hiveDir();
  const adopted = await lstat(swarmPaths(dir).adopted).then(
    () => true,
    () => false,
  );
  if (adopted) return;
  // A failed read of the swarm-owned folders never stops the seed (HIVE-441).
  const exclude = await swarmSeedSets().then(
    (sets) => sets.shipped.exclude,
    () => undefined,
  );
  try {
    if ((await seed(exclude)) === null) throw new Error('the shipped seed failed');
    await adoptBuiltIns({ hiveDir: dir, shippedManifest: shippedOptions().manifestFile });
  } catch (cause) {
    console.info(`[hive] the built-in agents and skills could not be adopted as the Standard swarm (${String(cause)})`);
  }
}

/** Every swarm's seed manifest on disk, installed.json or not (HIVE-441): what settings sync reads beside the shipped one. */
export const swarmManifestFiles = (): Promise<string[]> => swarms().manifestFiles();

/** The set that owns one agent or skill: a swarm's, else the shipped one. */
export const swarmSeedSetFor = (kind: 'skills' | 'agents', name: string): Promise<SeedOptions> =>
  swarms().seedSetFor(shippedOptions(), `${kind}/${name}`);

/** An install link named this swarm (HIVE-442). Held until the renderer takes it: the window may not have loaded. */
export function requestSwarmInstall(swarmId: string): void {
  if (!isSwarmId(swarmId)) return;
  installRequest = swarmId;
  hooks.installRequested();
}

/** The swarm an install link named, once. It opens the consent screen and installs nothing. */
export function takeSwarmInstallRequest(): string | null {
  const taken = installRequest;
  installRequest = null;
  return taken;
}

/** For tests. */
export function resetSwarms(): void {
  installRequest = null;
  updates?.stop();
  updates = null;
  gitClient = null;
  hadSession = false;
  hooks = NO_HOOKS;
  engine = null;
}
