/**
 * The app's swarms (HIVE-441): one engine over `~/.hivetty`, and the three
 * calls the renderer may make.
 *
 * The cloud session, the session environment and the "skills changed" hooks
 * arrive through `setSwarmHooks`, as settings sync's do, so this folder
 * depends on neither the licence client nor the IPC layer.
 */
import { dirname } from 'node:path';

import {
  parseSwarmRequest,
  type SwarmInstallResult,
  type SwarmListing,
  type SwarmRemoveResult,
} from '@shared/swarm-contract';

import { configPath } from '../config/paths';
import { platform } from '../platform';
import { shippedOptions } from '../seed';
import type { SeedOptions } from '../seed/seed';

import { createSwarmGit } from './git';
import { createSwarms, mergeListing, type Swarms } from './install';
import { swarmPaths } from './paths';
import { cloneToken, readRegistry, type AuthedFetch } from './registry';

export interface SwarmHooks {
  /** The boot seed. Never rejects. */
  ready: () => Promise<unknown>;
  afterSkills: () => void;
  afterAgents: () => void;
  /** What Git runs in: the environment sessions get. */
  env: () => NodeJS.ProcessEnv;
  /** The signed-in cloud client's fetch, or null before there is one. */
  authedFetch: () => AuthedFetch | null;
}

const NO_HOOKS: SwarmHooks = {
  ready: () => Promise.resolve(),
  afterSkills: () => undefined,
  afterAgents: () => undefined,
  env: () => process.env,
  authedFetch: () => null,
};

let hooks: SwarmHooks = NO_HOOKS;
let engine: Swarms | null = null;

export function setSwarmHooks(next: SwarmHooks): void {
  hooks = next;
}

const hiveDir = (): string => dirname(configPath());

function swarms(): Swarms {
  engine ??= createSwarms({
    hiveDir: hiveDir(),
    shippedManifest: shippedOptions().manifestFile,
    appVersion: platform().lifecycle.version,
    // Read through `hooks` at call time: the hooks are set after the first caller asks for the engine.
    git: createSwarmGit({ env: () => hooks.env(), askpass: swarmPaths(hiveDir()).askpass }),
    cloneToken: (swarmId) => cloneToken(hooks.authedFetch(), swarmId),
    ready: () => hooks.ready(),
  });
  return engine;
}

export interface SwarmCalls {
  list(): Promise<SwarmListing>;
  install(payload: unknown): Promise<SwarmInstallResult>;
  remove(payload: unknown): Promise<SwarmRemoveResult>;
}

export function swarmCalls(): SwarmCalls {
  const registry = () => readRegistry(hooks.authedFetch(), swarmPaths(hiveDir()).registry);
  // Whether it worked or not: a failed update may have changed files before it failed.
  const changed = (): void => {
    hooks.afterSkills();
    hooks.afterAgents();
  };

  return {
    list: async () => mergeListing(await registry(), await swarms().installed()),
    install: async (payload) => {
      const { swarmId } = parseSwarmRequest(payload);
      // The row comes from the registry, never from the caller: a renderer cannot name a repository.
      const entry = (await registry()).swarms.find((row) => row.id === swarmId);
      if (entry === undefined) {
        return { ok: false, failure: { code: 'unavailable', message: "This swarm isn't available to your account." } };
      }
      const result = await swarms().install(entry);
      changed();
      return result;
    },
    remove: async (payload) => {
      const { swarmId } = parseSwarmRequest(payload);
      const result = await swarms().remove(swarmId);
      changed();
      return result;
    },
  };
}

/** The shipped seed options, minus the folders swarms own, and one set per installed swarm. */
export const swarmSeedSets = (): Promise<{ shipped: SeedOptions; swarms: SeedOptions[] }> =>
  swarms().seedSets(shippedOptions());

/** The set that owns one agent or skill: a swarm's, else the shipped one. */
export const swarmSeedSetFor = (kind: 'skills' | 'agents', name: string): Promise<SeedOptions> =>
  swarms().seedSetFor(shippedOptions(), `${kind}/${name}`);

/** For tests. */
export function resetSwarms(): void {
  hooks = NO_HOOKS;
  engine = null;
}
