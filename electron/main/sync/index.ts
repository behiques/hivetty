import { watch as fsWatch, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AccountState } from '@shared/account-contract';
import { CH } from '@shared/ipc-contract';
import {
  NO_ENCRYPTION,
  parseSetSyncGroupRequest,
  parseSyncedAppearance,
  type SetSyncGroupRequest,
  type SyncedAppearance,
  type SyncSetupResult,
  type SyncStatus,
} from '@shared/sync-contract';

import { applyMerge, conflictsSummary, CONFLICTS_DIR } from './apply';
import { collectFiles } from './bundle';
import { deriveKey } from './crypto';
import { createSyncEngine, type EngineDeps, type SyncEngine } from './engine';
import { createKeyStore, createStateStore } from './state';

const SIGN_IN = 'Sign in to use Sync';
const MAX_PASSPHRASE = 1024;
export const KEY_FILE = 'sync-key.bin';
export const STATE_FILE = 'sync-state.json';

/** What sync needs of the signed-in cloud session; `licence/index.ts`'s `cloudSession()` satisfies it. */
export interface SyncSession {
  authedFetch(path: string, init?: RequestInit): Promise<Response>;
  account(): AccountState;
  onAccountChange(listener: (state: AccountState) => void): () => void;
}

export interface SyncDeps {
  session: () => SyncSession | null;
  /** `entitled('sync')`: `null` is yes, otherwise the sentence a person reads. */
  entitled: () => string | null;
  onLicenceChange: (listener: () => void) => () => void;
  onConfigChange: (listener: () => void) => () => void;
  /** A window got focus (`browser-window-focus`). Returns its own removal. */
  onFocus: (listener: () => void) => () => void;
  /** `leaseSubject`: the user the key is bound to. */
  userId: () => string | null;
  safeStorage: Pick<Electron.SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;
  userData: string;
  /** The folder holding config.json, skills/ and agents/. */
  hiveDir: string;
  manifestFile: string;
  readDocument: () => Record<string, unknown> | null;
  /** `writeSyncedKeys`: false when the config refused the write. */
  writeConfig: (mutate: (draft: Record<string, unknown>) => Record<string, unknown>) => boolean;
  resetShipped: (kind: 'skills' | 'agents', name: string) => Promise<void>;
  openPath: (path: string) => Promise<string>;
  /** A recursive watch on a folder; returns its disposer. Defaults to `fs.watch`. */
  watch?: (dir: string, onChange: () => void) => () => void;
  createEngine?: (deps: EngineDeps) => SyncEngine;
}

export interface SyncHooks {
  /** `skills.sync()`: the skill list re-reads after synced skills were written. */
  afterSkills(): void;
  /** `refreshKnownAgents()`: the agent list re-reads after synced agents were written. */
  afterAgents(): void;
  /** The `config:changed` broadcast after synced keys were written. */
  afterConfig(): void;
}

export interface SyncCalls {
  [CH.syncStatus](): Promise<SyncStatus>;
  [CH.syncSetup](passphrase: string): Promise<SyncSetupResult>;
  [CH.syncSetGroup](request: SetSyncGroupRequest): Promise<void>;
  [CH.syncNow](): Promise<void>;
  [CH.syncReset](): Promise<SyncSetupResult>;
  [CH.syncOpenConflicts](): Promise<void>;
  [CH.syncReportAppearance](fields: SyncedAppearance): Promise<void>;
}

type Closed = Extract<SyncStatus, { kind: 'unavailable' }>;

const NO_HOOKS: SyncHooks = { afterSkills: () => undefined, afterAgents: () => undefined, afterConfig: () => undefined };
let hooks: SyncHooks = NO_HOOKS;

/** Registered by `ipc/index.ts`, which owns the skill list, the agent list and the window broadcast. */
export function setSyncHooks(next: SyncHooks): void {
  hooks = next;
}

const statusListeners = new Set<(status: SyncStatus) => void>();
const appearanceListeners = new Set<(fields: SyncedAppearance) => void>();
let current: SyncStatus = { kind: 'unavailable', reason: 'signed-out' };

interface Running {
  gate(): Closed | null;
  engine(): SyncEngine | null;
  refusal(): string;
  openConflicts(): Promise<void>;
}
let running: Running | null = null;

function publish(status: SyncStatus): void {
  if (JSON.stringify(status) === JSON.stringify(current)) return;
  current = status;
  for (const listener of [...statusListeners]) listener(status);
}

export function onSyncStatus(listener: (status: SyncStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function onSyncAppearance(listener: (fields: SyncedAppearance) => void): () => void {
  appearanceListeners.add(listener);
  return () => appearanceListeners.delete(listener);
}

function defaultWatch(dir: string, onChange: () => void): () => void {
  const watcher = fsWatch(dir, { recursive: true }, () => onChange());
  watcher.on('error', () => undefined);
  return () => watcher.close();
}

const isRealFolder = (path: string): boolean => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Settings sync's gate (HIVE-284), the relay's shape: the engine runs only while the account is signed in, the
 * lease carries `sync` and the keychain can seal the key. Re-evaluated on every account and licence change. A
 * sign-out, or another account signing in, deletes the key and the merge base; losing the entitlement only
 * stops the engine.
 */
export function startSync(deps: SyncDeps): { stop(): void } {
  const keys = createKeyStore({ file: join(deps.userData, KEY_FILE), safeStorage: deps.safeStorage });
  const state = createStateStore(join(deps.hiveDir, STATE_FILE));
  const watchFolder = deps.watch ?? defaultWatch;
  let engine: SyncEngine | null = null;

  const emailOf = (): string | null => {
    const account = deps.session()?.account();
    return account?.kind === 'signed-in' ? account.email : null;
  };
  // A restart as the same person keeps the key; anyone else signing in later wipes it.
  let owner: string | null = keys.read() !== null || state.read() !== null ? emailOf() : null;

  const gate = (): Closed | null => {
    if (emailOf() === null) return { kind: 'unavailable', reason: 'signed-out' };
    if (deps.entitled() !== null) return { kind: 'unavailable', reason: 'locked' };
    if (!deps.safeStorage.isEncryptionAvailable()) return { kind: 'unavailable', reason: 'no-encryption' };
    return null;
  };

  const build = (): SyncEngine =>
    (deps.createEngine ?? createSyncEngine)({
      fetch: (path, init) => {
        const session = deps.session();
        return session === null ? Promise.reject(new Error('no cloud session')) : session.authedFetch(path, init);
      },
      userId: deps.userId,
      keys,
      state,
      readDocument: deps.readDocument,
      collectFiles: () => collectFiles(deps.hiveDir, deps.manifestFile),
      apply: (result, kept) =>
        applyMerge(
          {
            hiveDir: deps.hiveDir,
            manifestFile: deps.manifestFile,
            writeConfig: (mutate) => {
              const ok = deps.writeConfig(mutate);
              if (ok) hooks.afterConfig();
              return ok;
            },
            resetShipped: deps.resetShipped,
            sendAppearance: (fields) => {
              for (const listener of [...appearanceListeners]) listener(fields);
            },
            afterSkills: () => hooks.afterSkills(),
            afterAgents: () => hooks.afterAgents(),
            now: Date.now,
          },
          result,
          kept,
        ),
      conflicts: () => conflictsSummary(deps.hiveDir),
      deriveKey: (passphrase, salt) => deriveKey(passphrase, salt),
      now: Date.now,
      onStatus: publish,
    });

  function evaluate(): void {
    const email = emailOf();
    // Another person on this Mac must never inherit the last one's key or merge base.
    if (email !== owner) {
      if (owner !== null) {
        engine?.stop({ wipe: true });
        keys.clear();
        state.clear();
      } else {
        engine?.stop();
      }
      engine = null;
      owner = email;
    }
    const closed = gate();
    if (closed !== null) {
      engine?.stop();
      engine = null;
      publish(closed);
      return;
    }
    if (engine === null) {
      engine = build();
      engine.start();
      publish(engine.status());
    }
  }

  const watchers = ['skills', 'agents']
    .map((name) => join(deps.hiveDir, name))
    .filter(isRealFolder)
    .map((dir) => {
      try {
        return watchFolder(dir, () => engine?.changed());
      } catch {
        return () => undefined;
      }
    });
  const unsubscribe = [
    deps.session()?.onAccountChange(evaluate) ?? (() => undefined),
    deps.onLicenceChange(evaluate),
    deps.onConfigChange(() => engine?.changed()),
    deps.onFocus(() => void engine?.now()),
    ...watchers,
  ];

  running = {
    gate,
    engine: () => engine,
    refusal: () => {
      const closed = gate();
      if (closed?.reason === 'locked') return deps.entitled() ?? SIGN_IN;
      if (closed?.reason === 'no-encryption') return NO_ENCRYPTION;
      return SIGN_IN;
    },
    async openConflicts() {
      const folder = join(deps.hiveDir, CONFLICTS_DIR);
      mkdirSync(folder, { recursive: true });
      await deps.openPath(folder);
    },
  };
  evaluate();

  return {
    stop() {
      for (const stop of unsubscribe) stop();
      engine?.stop();
      engine = null;
      running = null;
    },
  };
}

function checkPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== 'string' || passphrase.length === 0 || passphrase.length > MAX_PASSPHRASE) {
    throw new TypeError('sync:setup: expected a passphrase of 1 to 1024 characters');
  }
  return passphrase;
}

/** The seven `sync:*` calls, each answered from the gate first, then from the running engine. */
export function syncCalls(): SyncCalls {
  const open = (): SyncEngine | null => (running?.gate() === null ? running.engine() : null);
  return {
    [CH.syncStatus]: async () => {
      const closed: Closed | null = running === null ? { kind: 'unavailable', reason: 'signed-out' } : running.gate();
      if (closed !== null) return closed;
      const engine = running?.engine();
      return engine ? engine.refresh() : current;
    },
    [CH.syncSetup]: async (passphrase) => {
      const engine = open();
      if (engine === null) return { ok: false, error: running?.refusal() ?? SIGN_IN };
      return engine.setup(checkPassphrase(passphrase));
    },
    [CH.syncSetGroup]: async (request) => {
      const engine = open();
      if (engine === null) return;
      const { group, on } = parseSetSyncGroupRequest(request);
      await engine.setGroup(group, on);
    },
    [CH.syncNow]: async () => {
      await open()?.now();
    },
    [CH.syncReset]: async () => {
      const engine = open();
      if (engine === null) return { ok: false, error: running?.refusal() ?? SIGN_IN };
      return engine.reset();
    },
    [CH.syncOpenConflicts]: async () => {
      if (open() === null) return;
      await running?.openConflicts();
    },
    [CH.syncReportAppearance]: async (fields) => {
      open()?.reportAppearance(parseSyncedAppearance(fields));
    },
  };
}

/** Test-only. */
export function resetSync(): void {
  running = null;
  current = { kind: 'unavailable', reason: 'signed-out' };
  statusListeners.clear();
  appearanceListeners.clear();
  hooks = NO_HOOKS;
}
