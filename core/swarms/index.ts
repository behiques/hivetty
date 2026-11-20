/**
 * The app's swarms (HIVE-441): one engine over `~/.hivetty`, the calls the
 * renderer may make, and the updater that keeps installed swarms current (HIVE-442).
 *
 * The cloud session, the session environment and the "skills changed" hooks
 * arrive through `setSwarmHooks`, as settings sync's do, so this folder
 * depends on neither the licence client nor the IPC layer.
 */
import { lstat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  disabledOf,
  isBundled,
  parseSwarmAutoUpdateRequest,
  parseSwarmRequest,
  parseSwarmSetEnabledRequest,
  type InstalledSwarm,
  type SwarmDisabled,
  type SwarmEntry,
  type SwarmInstallResult,
  type SwarmItemKind,
  type SwarmListing,
  type SwarmRemoveResult,
  type SwarmsChanged,
  isSwarmId,
} from '@shared/swarm-contract';

import { configPath } from '../config/paths';
import { platform } from '../platform';
import { resetShipped, serial } from '../seed/actions';
import { SEED_MANIFEST_FILE } from '../seed/paths';
import { readManifest, type SeedOptions } from '../seed/seed';

import { adoptBuiltIns, rekeyAdopted, rekeyTarget } from './adopt';
import { createSwarmGit, type SwarmGit } from './git';
import { createSwarms, mergeListing, missingOf, ownedFolders, type Swarms } from './install';
import { swarmPaths } from './paths';
import { cloneToken, readRegistry, type AuthedFetch, type RegistryRead } from './registry';
import { reportFor, reportInstall } from './report';
import { createSwarmUpdater, type SwarmUpdater } from './update';

export interface SwarmHooks {
  /** Boot's adoption (HIVE-447; boot seeds nothing since HIVE-448). Never rejects. */
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
    shippedManifest: join(hiveDir(), SEED_MANIFEST_FILE),
    appVersion: platform().lifecycle.version,
    git: git(),
    cloneToken: (swarmId) => cloneToken(hooks.authedFetch(), swarmId),
    ready: () => hooks.ready(),
  });
  return engine;
}

const registry = async (): Promise<RegistryRead> => {
  const read = await readRegistry(hooks.authedFetch(), swarmPaths(hiveDir()).registry);
  // HIVE-447: the adopted Dev Squad takes the registry's id, in the install queue and after boot's adoption. Never the
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
  /** HIVE-453: turn one of a swarm's agents or skills off or back on. */
  setEnabled(payload: unknown): Promise<InstalledSwarm | null>;
  check(): Promise<SwarmListing>;
}

export function swarmCalls(): SwarmCalls {
  const list = async (): Promise<SwarmListing> => {
    const [read, installed] = [await registry(), await swarms().installed()];
    // HIVE-453: mergeListing is synchronous, so each installed swarm's missing files are read first.
    const dir = hiveDir();
    const missing = new Map(
      await Promise.all(installed.map(async (held) => [held.swarmId, await missingOf(dir, held.swarmId)] as const)),
    );
    return mergeListing(
      read,
      installed,
      (swarmId) => updater().pending(swarmId),
      (swarmId) => missing.get(swarmId) ?? { agents: [], skills: [] },
    );
  };

  return {
    list,
    install: async (payload) => {
      const { swarmId } = parseSwarmRequest(payload);
      // The install waits for the seed and the adoption in its queue anyway. Waiting here first lets the read below
      // re-key an entry adopted meanwhile, so a first-launch click updates it instead of colliding with it.
      await hooks.ready();
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
        // A bundled Dev Squad was never reported as installed (HIVE-447).
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
    setEnabled: async (payload) => {
      const { swarmId, kind, name, enabled } = parseSwarmSetEnabledRequest(payload); // throws: nothing written
      const result = await swarms().setEnabled(swarmId, kind, name, enabled); // null when nothing was written
      if (result !== null) {
        refresh(); // the plugins leave out an off skill; the agent sets learn an off agent
        hooks.changed({ updated: null });
      }
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

/** One seed set per installed swarm (HIVE-448: the app ships none of its own). */
export const swarmSeedSets = (): Promise<SeedOptions[]> => swarms().seedSets();

/**
 * Boot (HIVE-447, HIVE-448): adoption and nothing else, since the app ships no agents and no skills. A home an older
 * release seeded, never adopted, becomes the installed Dev Squad; a fresh home gets only the marker. This is the
 * promise every install, removal and seed action waits for (`hooks.ready`), so adoption runs here and never in their
 * queue: queued behind them it would wait on itself. Never rejects: a failed adoption leaves no marker and the next
 * launch tries again.
 */
export async function adopt(): Promise<void> {
  try {
    const dir = hiveDir();
    const adopted = await lstat(swarmPaths(dir).adopted).then(
      () => true,
      () => false,
    );
    if (adopted) return;
    await adoptBuiltIns({ hiveDir: dir, shippedManifest: join(dir, SEED_MANIFEST_FILE) });
  } catch (cause) {
    console.info(`[hive] the built-in agents and skills could not be adopted as the Dev Squad swarm (${String(cause)})`);
  }
}

/** Every swarm's seed manifest on disk, installed.json or not (HIVE-441): what settings sync reads. */
export const swarmManifestFiles = (): Promise<string[]> => swarms().manifestFiles();

/** The set of the swarm that owns one agent or skill, or null when no swarm owns it. */
export const swarmSeedSetFor = (kind: 'skills' | 'agents', name: string): Promise<SeedOptions | null> =>
  swarms().seedSetFor(`${kind}/${name}`);

/**
 * HIVE-453: the swarm whose seed manifest owns `<kind>/<name>`, or null. Unlike {@link swarmSeedSetFor} it includes
 * bundled swarms, and it reads manifests, not folders, so it holds for a name whose folder is already gone. A pending
 * first install is not an owner.
 */
export async function swarmOwns(kind: SwarmItemKind, name: string): Promise<{ swarmId: string } | null> {
  for (const file of await swarmManifestFiles()) {
    if (basename(file) !== 'seed.json') continue;
    if (ownedFolders(await readManifest(file)).has(`${kind}/${name}`)) return { swarmId: basename(dirname(file)) };
  }
  return null;
}

/** HIVE-453: every name any installed swarm has turned off, per kind. */
export async function swarmDisabledNames(): Promise<SwarmDisabled> {
  const off = (await swarms().installed()).map(disabledOf);
  return { agents: off.flatMap((d) => d.agents), skills: off.flatMap((d) => d.skills) };
}

/** Settings sync's reset of one file: through the swarm that owns it, and nothing for a name no swarm owns. */
export async function resetOwnedFile(kind: 'skills' | 'agents', name: string): Promise<void> {
  const owner = await swarmSeedSetFor(kind, name);
  if (owner) await resetShipped(owner, { kind, name });
}

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
