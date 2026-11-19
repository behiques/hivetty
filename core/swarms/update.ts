/**
 * Swarm updates (HIVE-442). Finds a newer target for each installed swarm and applies the automatic ones:
 * native and organization swarms with "Update automatically" on, or pinned by their organization, and only
 * while no agent run is live. Community swarms wait for the person. Applying is the caller's install path.
 */
import type { InstalledSwarm, SwarmEntry, SwarmInstallResult, SwarmUpdate } from '@shared/swarm-contract';

import type { RegistryRead } from './registry';

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface SwarmUpdaterDeps {
  registry: () => Promise<RegistryRead>;
  installed: () => Promise<InstalledSwarm[]>;
  newestVersion: (repoUrl: string, folder: string) => Promise<string | null>;
  /** The app's one install path: it reports and tells the renderer itself. Never rejects. */
  apply: (entry: SwarmEntry) => Promise<SwarmInstallResult>;
  runsLive: () => boolean;
  /** A pending update appeared, moved or cleared: the list should be read again. */
  changed: () => void;
  /** An update was applied with nobody asking. */
  notify: (updated: { swarmId: string; title: string; version: string }) => void;
}

export interface SwarmUpdater {
  check(): Promise<void>;
  /** The last agent run ended: apply what is pending. Reads nothing. */
  idle(): Promise<void>;
  pending(swarmId: string): SwarmUpdate | null;
  /** An install or a removal settled this swarm some other way. */
  clear(swarmId: string): void;
  start(): void;
  stop(): void;
}

interface Pending {
  entry: SwarmEntry;
  target: string;
  updating: boolean;
  /** The automatic apply failed: left for the next check, not for the next idle. */
  failed: boolean;
}

/** Not community, and the switch is on or the organization pinned it: the pin wins over the switch. */
const isAutomatic = (entry: SwarmEntry, installed: InstalledSwarm): boolean =>
  entry.kind !== 'community' &&
  (installed.autoUpdate || (entry.kind === 'organization' && entry.policy === 'pinned'));

export function createSwarmUpdater(deps: SwarmUpdaterDeps): SwarmUpdater {
  const held = new Map<string, Pending>();
  let running: Promise<void> | null = null;
  /** The running job is a check that has not read the installed list yet: a check asked now sees what it will. */
  let joinable = false;
  let queuedCheck: { promise: Promise<void>; resolve: () => void } | null = null;
  let idleQueued = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const targetOf = (entry: SwarmEntry): Promise<string | null> => {
    if (entry.kind !== 'organization') return Promise.resolve(entry.version);
    if (entry.policy === 'pinned') return Promise.resolve(entry.pinnedVersion);
    return deps.newestVersion(entry.repoUrl, entry.folder);
  };

  const drop = (swarmId: string): boolean => held.delete(swarmId);

  const applyOne = async (swarmId: string, pending: Pending): Promise<void> => {
    held.set(swarmId, { ...pending, updating: true });
    deps.changed();
    const result = await deps.apply(pending.entry); // never rejects; a failure is a result
    if (result.ok) {
      held.delete(swarmId);
      deps.notify({ swarmId, title: result.installed.title, version: result.installed.version });
    } else {
      held.set(swarmId, { ...pending, updating: false, failed: true });
    }
  };

  const applyPending = async (retryFailed: boolean): Promise<void> => {
    if (held.size === 0) return;
    // Read again, from disk only: a switch turned off, a removal or a clicked install since the check wins.
    const now = new Map((await deps.installed()).map((installed) => [installed.swarmId, installed]));
    let moved = false;
    for (const [swarmId, pending] of [...held]) {
      const installed = now.get(swarmId);
      if (installed === undefined || installed.version === pending.target) {
        moved = drop(swarmId) || moved;
        continue;
      }
      if (!isAutomatic(pending.entry, installed) || (pending.failed && !retryFailed)) continue;
      if (deps.runsLive()) break; // asked per swarm: a run may start between two installs
      await applyOne(swarmId, pending);
    }
    if (moved) deps.changed();
  };

  const checkNow = async (): Promise<void> => {
    const registry = await deps.registry();
    // Offline or signed out says nothing about what is newest, or about what left the registry.
    if (registry.source !== 'cloud') return;
    const rows = new Map(registry.swarms.map((row) => [row.id, row]));
    let moved = false;

    joinable = false; // from here a switch turned on is not seen: a later check runs after this one
    const installedNow = await deps.installed();
    const present = new Set(installedNow.map((installed) => installed.swarmId));
    for (const swarmId of [...held.keys()]) {
      if (!present.has(swarmId)) moved = drop(swarmId) || moved;
    }

    for (const installed of installedNow) {
      const entry = rows.get(installed.swarmId);
      if (entry === undefined) {
        moved = drop(installed.swarmId) || moved;
        continue;
      }
      let target: string | null;
      try {
        target = await targetOf(entry);
      } catch {
        continue; // the repository cannot be reached: what was pending stays
      }
      if (target === null || target === installed.version) {
        moved = drop(installed.swarmId) || moved;
        continue;
      }
      const before = held.get(installed.swarmId);
      if (before?.target !== target || before.updating) moved = true;
      held.set(installed.swarmId, { entry, target, updating: false, failed: false });
    }

    if (moved) deps.changed();
    await applyPending(true);
  };

  /** One job at a time. A rejection ends the job and is not the caller's: the next trigger tries again. */
  const exclusive = (job: () => Promise<void>, isCheck: boolean): Promise<void> => {
    joinable = isCheck;
    const current = job()
      .catch(() => undefined)
      .finally(() => {
        running = null;
        joinable = false;
        if (queuedCheck !== null) {
          const { resolve } = queuedCheck;
          queuedCheck = null;
          void exclusive(checkNow, true).then(resolve);
        } else if (idleQueued) {
          idleQueued = false;
          void exclusive(() => applyPending(false), false);
        }
      });
    running = current;
    return current;
  };

  const check = (): Promise<void> => {
    if (running === null) return exclusive(checkNow, true);
    if (joinable) return running;
    if (queuedCheck === null) {
      let resolve: () => void = () => undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      queuedCheck = { promise, resolve };
    }
    return queuedCheck.promise;
  };

  return {
    check,
    idle: () => {
      if (running !== null) {
        idleQueued = true;
        return running;
      }
      return exclusive(() => applyPending(false), false);
    },
    pending: (swarmId) => {
      const pending = held.get(swarmId);
      return pending === undefined ? null : { target: pending.target, updating: pending.updating };
    },
    clear: (swarmId) => {
      held.delete(swarmId);
    },
    start: () => {
      if (timer !== null) return;
      timer = setInterval(() => void check(), CHECK_EVERY_MS);
      timer.unref(); // never the reason the process stays up
    },
    stop: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
