// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EngineDeps, SyncEngine } from '../../../core/sync/engine';
import {
  onSyncAppearance,
  onSyncStatus,
  resetSync,
  setSyncHooks,
  startSync,
  syncCalls,
  type SyncDeps,
} from '../../../core/sync';
import type { AccountState } from '../../../shared/account-contract';
import { CH } from '../../../shared/ipc-contract';
import { NO_ENCRYPTION, type SyncStatus } from '../../../shared/sync-contract';

/**
 * Settings sync's gate and wiring (HIVE-284): it runs only signed in and entitled, a sign-out or another
 * account wipes the key, and every `sync:*` call answers from the gate first.
 */

const SIGNED_IN = (email = 'ada@acme.dev'): AccountState =>
  ({ kind: 'signed-in', email, name: 'Ada', deviceId: 'dev_1' }) as AccountState;

let dir: string;

function fakeEngine(): SyncEngine & { deps: EngineDeps | null } {
  const on: SyncStatus = {
    kind: 'on',
    lastSyncedAt: null,
    groups: { harnesses: true, automation: true, workspace: true },
    conflicts: { count: 0, latest: null },
    problem: null,
  };
  return {
    deps: null,
    status: vi.fn(() => on),
    refresh: vi.fn(() => Promise.resolve(on)),
    setup: vi.fn(() => Promise.resolve({ ok: true as const })),
    setGroup: vi.fn(() => Promise.resolve()),
    reportAppearance: vi.fn(),
    changed: vi.fn(),
    now: vi.fn(() => Promise.resolve()),
    idle: vi.fn(() => Promise.resolve()),
    reset: vi.fn(() => Promise.resolve({ ok: true as const })),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function harness(options: { account?: AccountState; entitled?: string | null; encryption?: boolean } = {}) {
  let account: AccountState = options.account ?? SIGNED_IN();
  let entitled: string | null = options.entitled === undefined ? null : options.entitled;
  const accountListeners = new Set<(state: AccountState) => void>();
  const licenceListeners = new Set<() => void>();
  const configListeners = new Set<() => void>();
  const focusListeners = new Set<() => void>();
  const unsubscribed: string[] = [];
  const engines: ReturnType<typeof fakeEngine>[] = [];
  const watched: string[] = [];
  const openPath = vi.fn(() => Promise.resolve(''));
  const authedFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
  const deps: SyncDeps = {
    session: () => ({
      authedFetch,
      account: () => account,
      onAccountChange: (listener) => {
        accountListeners.add(listener);
        return () => {
          unsubscribed.push('account');
          accountListeners.delete(listener);
        };
      },
    }),
    entitled: () => entitled,
    onLicenceChange: (listener) => {
      licenceListeners.add(listener);
      return () => {
        unsubscribed.push('licence');
        licenceListeners.delete(listener);
      };
    },
    onConfigChange: (listener) => {
      configListeners.add(listener);
      return () => {
        unsubscribed.push('config');
        configListeners.delete(listener);
      };
    },
    onFocus: (listener) => {
      focusListeners.add(listener);
      return () => {
        unsubscribed.push('focus');
        focusListeners.delete(listener);
      };
    },
    userId: () => 'usr_1',
    safeStorage: {
      isEncryptionAvailable: () => options.encryption ?? true,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    },
    userData: dir,
    hiveDir: dir,
    manifestFiles: () => Promise.resolve([join(dir, '.seed.json')]),
    readDocument: () => ({}),
    writeConfig: () => true,
    resetShipped: () => Promise.resolve(),
    openPath,
    watch: (path, onChange) => {
      watched.push(path);
      void onChange;
      return () => unsubscribed.push(`watch:${path}`);
    },
    createEngine: (engineDeps) => {
      const engine = fakeEngine();
      engine.deps = engineDeps;
      engines.push(engine);
      return engine;
    },
  };
  return {
    deps,
    engines,
    watched,
    unsubscribed,
    openPath,
    authedFetch,
    setAccount(next: AccountState) {
      account = next;
      for (const listener of [...accountListeners]) listener(next);
    },
    setEntitled(next: string | null) {
      entitled = next;
      for (const listener of [...licenceListeners]) listener();
    },
    configChanged: () => {
      for (const listener of [...configListeners]) listener();
    },
    focus: () => {
      for (const listener of [...focusListeners]) listener();
    },
  };
}

const keyFile = () => join(dir, 'sync-key.bin');
const stateFile = () => join(dir, 'sync-state.json');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-index-'));
});

afterEach(() => {
  resetSync();
  rmSync(dir, { recursive: true, force: true });
});

describe('before startSync', () => {
  it('answers signed out and refuses every call', async () => {
    const calls = syncCalls();
    await expect(calls[CH.syncStatus]()).resolves.toEqual({ kind: 'unavailable', reason: 'signed-out' });
    await expect(calls[CH.syncSetup]('correct horse battery')).resolves.toEqual({ ok: false, error: 'Sign in to use Sync' });
    await expect(calls[CH.syncReset]()).resolves.toEqual({ ok: false, error: 'Sign in to use Sync' });
    await expect(calls[CH.syncNow]()).resolves.toBeUndefined();
  });
});

describe('the gate', () => {
  it('does not start the engine signed out, and says why', async () => {
    const h = harness({ account: { kind: 'signed-out' } });
    startSync(h.deps);
    expect(h.engines).toEqual([]);
    await expect(syncCalls()[CH.syncStatus]()).resolves.toEqual({ kind: 'unavailable', reason: 'signed-out' });
  });

  it('does not start the engine without the feature, and answers the entitlement’s sentence', async () => {
    const h = harness({ entitled: 'Sync is part of Pro.' });
    startSync(h.deps);
    expect(h.engines).toEqual([]);
    await expect(syncCalls()[CH.syncStatus]()).resolves.toEqual({ kind: 'unavailable', reason: 'locked' });
    await expect(syncCalls()[CH.syncSetup]('correct horse battery')).resolves.toEqual({
      ok: false,
      error: 'Sync is part of Pro.',
    });
  });

  it('does not start without keychain encryption, and set-up says so', async () => {
    const h = harness({ encryption: false });
    startSync(h.deps);
    expect(h.engines).toEqual([]);
    await expect(syncCalls()[CH.syncStatus]()).resolves.toEqual({ kind: 'unavailable', reason: 'no-encryption' });
    await expect(syncCalls()[CH.syncSetup]('correct horse battery')).resolves.toEqual({ ok: false, error: NO_ENCRYPTION });
  });

  it('starts the engine signed in and entitled, and answers from it', async () => {
    const h = harness();
    startSync(h.deps);
    expect(h.engines).toHaveLength(1);
    expect(h.engines[0]?.start).toHaveBeenCalledTimes(1);
    await expect(syncCalls()[CH.syncStatus]()).resolves.toMatchObject({ kind: 'on' });
    await syncCalls()[CH.syncSetup]('correct horse battery');
    expect(h.engines[0]?.setup).toHaveBeenCalledWith('correct horse battery');
  });

  it('wipes the key and the state on sign-out', () => {
    const h = harness();
    startSync(h.deps);
    writeFileSync(keyFile(), 'k');
    writeFileSync(stateFile(), '{}');
    h.setAccount({ kind: 'signed-out' });
    expect(h.engines[0]?.stop).toHaveBeenCalledWith({ wipe: true });
    expect(existsSync(keyFile())).toBe(false);
    expect(existsSync(stateFile())).toBe(false);
  });

  it('wipes on sign-out even while the gate was closed', () => {
    const h = harness({ entitled: 'Sync is part of Pro.' });
    writeFileSync(keyFile(), 'k');
    startSync(h.deps);
    h.setAccount({ kind: 'signed-out' });
    expect(existsSync(keyFile())).toBe(false);
  });

  it('keeps the key across a restart as the same person', () => {
    writeFileSync(keyFile(), 'k');
    const h = harness();
    startSync(h.deps);
    expect(existsSync(keyFile())).toBe(true);
    expect(h.engines).toHaveLength(1);
  });

  it('stops without wiping when the entitlement is lost, and starts again when it returns', () => {
    const h = harness();
    startSync(h.deps);
    writeFileSync(keyFile(), 'k');
    h.setEntitled('Your plan ended.');
    expect(h.engines[0]?.stop).toHaveBeenCalledWith();
    expect(existsSync(keyFile())).toBe(true);
    h.setEntitled(null);
    expect(h.engines).toHaveLength(2);
  });

  it('wipes when another account signs in', () => {
    const h = harness();
    startSync(h.deps);
    writeFileSync(keyFile(), 'k');
    h.setAccount(SIGNED_IN('bob@acme.dev'));
    expect(h.engines[0]?.stop).toHaveBeenCalledWith({ wipe: true });
    expect(existsSync(keyFile())).toBe(false);
    expect(h.engines).toHaveLength(2);
  });

  it('a sign-in started and cancelled while signed in keeps the key', () => {
    const h = harness();
    startSync(h.deps);
    writeFileSync(keyFile(), 'k');
    h.setAccount({ kind: 'signing-in' } as AccountState);
    h.setAccount(SIGNED_IN());
    expect(existsSync(keyFile())).toBe(true);
    expect(h.engines[0]?.stop).not.toHaveBeenCalledWith({ wipe: true });
  });

  it('wipes a key left on disk when the app starts signed out', () => {
    writeFileSync(keyFile(), 'k');
    writeFileSync(stateFile(), '{}');
    startSync(harness({ account: { kind: 'signed-out' } }).deps);
    expect(existsSync(keyFile())).toBe(false);
    expect(existsSync(stateFile())).toBe(false);
  });

  it('ignores the status of an engine that is no longer the running one', () => {
    const heard: SyncStatus[] = [];
    const off = onSyncStatus((status) => heard.push(status));
    const h = harness();
    startSync(h.deps);
    const old = h.engines[0];
    h.setAccount({ kind: 'signed-out' });
    old?.deps?.onStatus({ kind: 'off', cloud: 'none', resetElsewhere: false });
    expect(heard.at(-1)).toEqual({ kind: 'unavailable', reason: 'signed-out' });
    off();
  });

  it('a set-up that finishes after the gate closed answers the refusal', async () => {
    const h = harness();
    startSync(h.deps);
    let finish: (value: { ok: true }) => void = () => undefined;
    vi.mocked(h.engines[0]!.setup).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const pending = syncCalls()[CH.syncSetup]('correct horse battery');
    h.setAccount({ kind: 'signed-out' });
    finish({ ok: true });
    await expect(pending).resolves.toEqual({ ok: false, error: 'Sign in to use Sync' });
  });

  it('a repeated signed-in notice for the same person changes nothing', () => {
    const h = harness();
    startSync(h.deps);
    h.setAccount(SIGNED_IN());
    expect(h.engines).toHaveLength(1);
    expect(h.engines[0]?.stop).not.toHaveBeenCalled();
  });

  it('publishes the closed status to listeners', () => {
    const heard: SyncStatus[] = [];
    const off = onSyncStatus((status) => heard.push(status));
    const h = harness();
    startSync(h.deps);
    h.setEntitled('Your plan ended.');
    expect(heard.at(-1)).toEqual({ kind: 'unavailable', reason: 'locked' });
    off();
  });

  it('hands the engine’s status to listeners', () => {
    const heard: SyncStatus[] = [];
    const off = onSyncStatus((status) => heard.push(status));
    const h = harness();
    startSync(h.deps);
    h.engines[0]?.deps?.onStatus({ kind: 'off', cloud: 'none', resetElsewhere: false });
    expect(heard.at(-1)).toEqual({ kind: 'off', cloud: 'none', resetElsewhere: false });
    off();
  });
});

describe('triggers', () => {
  it('a config change calls changed, and a focus calls now', () => {
    const h = harness();
    startSync(h.deps);
    h.configChanged();
    expect(h.engines[0]?.changed).toHaveBeenCalledTimes(1);
    h.focus();
    expect(h.engines[0]?.now).toHaveBeenCalledTimes(1);
  });

  it('watches skills and agents when each is a real folder', () => {
    mkdirSync(join(dir, 'skills'));
    mkdirSync(join(dir, 'elsewhere'));
    symlinkSync(join(dir, 'elsewhere'), join(dir, 'agents'));
    const h = harness();
    startSync(h.deps);
    expect(h.watched).toEqual([join(dir, 'skills')]);
  });

  it('stop removes every listener and watcher', () => {
    mkdirSync(join(dir, 'skills'));
    const h = harness();
    const sync = startSync(h.deps);
    sync.stop();
    expect(h.unsubscribed.sort()).toEqual(['account', 'config', 'focus', 'licence', `watch:${join(dir, 'skills')}`].sort());
    expect(h.engines[0]?.stop).toHaveBeenCalled();
  });
});

describe('the calls', () => {
  it('validates set-up, set-group and report-appearance at the boundary', async () => {
    const h = harness();
    startSync(h.deps);
    const calls = syncCalls();
    await expect(calls[CH.syncSetup]('')).rejects.toThrow(TypeError);
    await expect(calls[CH.syncSetup]('x'.repeat(1025))).rejects.toThrow(TypeError);
    await expect(calls[CH.syncSetup](42 as unknown as string)).rejects.toThrow(TypeError);
    await expect(calls[CH.syncSetGroup]({ group: 'projects', on: true } as never)).rejects.toThrow(TypeError);
    await calls[CH.syncSetGroup]({ group: 'workspace', on: false });
    expect(h.engines[0]?.setGroup).toHaveBeenCalledWith('workspace', false);
    await calls[CH.syncReportAppearance]({ density: 'compact', listPanelWidth: 300 } as never);
    expect(h.engines[0]?.reportAppearance).toHaveBeenCalledWith({ density: 'compact' });
  });

  it('now and reset reach the engine', async () => {
    const h = harness();
    startSync(h.deps);
    await syncCalls()[CH.syncNow]();
    expect(h.engines[0]?.now).toHaveBeenCalled();
    await expect(syncCalls()[CH.syncReset]()).resolves.toEqual({ ok: true });
  });

  it('open-conflicts creates the folder and opens it, taking no path', async () => {
    const h = harness();
    startSync(h.deps);
    await syncCalls()[CH.syncOpenConflicts]();
    expect(existsSync(join(dir, 'sync-conflicts'))).toBe(true);
    expect(h.openPath).toHaveBeenCalledWith(join(dir, 'sync-conflicts'));
  });

  it('open-conflicts does nothing while locked', async () => {
    const h = harness({ entitled: 'no' });
    startSync(h.deps);
    await syncCalls()[CH.syncOpenConflicts]();
    expect(h.openPath).not.toHaveBeenCalled();
  });
});

describe('the engine’s wiring', () => {
  it('sends appearance to listeners, runs the hooks after applying, and fetches through the session', async () => {
    const heard: unknown[] = [];
    const off = onSyncAppearance((fields) => heard.push(fields));
    const afterSkills = vi.fn();
    const afterAgents = vi.fn();
    const afterConfig = vi.fn();
    setSyncHooks({ afterSkills, afterAgents, afterConfig });
    const h = harness();
    startSync(h.deps);
    const deps = h.engines[0]?.deps;
    expect(deps).toBeTruthy();
    await deps?.apply(
      {
        merged: {},
        set: {
          'workspace:k:appearance.density': { hash: 'h', at: 1, data: 'compact' },
          'harnesses:k:claudeCommand': { hash: 'h2', at: 1, data: 'claude' },
          'automation:f:skills/a/SKILL.md': { hash: 'h3', at: 1, data: Buffer.from('a').toString('base64') },
        },
        remove: [],
        conflicts: {},
        push: false,
      },
      {},
    );
    expect(heard).toEqual([{ density: 'compact' }]);
    expect(afterSkills).toHaveBeenCalledTimes(1);
    expect(afterConfig).toHaveBeenCalledTimes(1);
    expect(afterAgents).not.toHaveBeenCalled();
    await deps?.fetch('/api/sync');
    expect(h.authedFetch).toHaveBeenCalledWith('/api/sync', undefined);
    expect(deps?.userId()).toBe('usr_1');
    await expect(deps?.collectFiles()).resolves.toEqual({ 'automation:f:skills/a/SKILL.md': expect.anything() as unknown });
    await expect(deps?.conflicts()).resolves.toEqual({ count: 0, latest: null });
    off();
  });

  it('asks for the manifest list on every collectFiles, because installs change it (HIVE-441)', async () => {
    const h = harness();
    mkdirSync(join(dir, 'skills/s'), { recursive: true });
    writeFileSync(join(dir, 'skills/s/SKILL.md'), 'swarm');
    writeFileSync(
      join(dir, 'swarm-seed.json'),
      JSON.stringify({ files: { 'skills/s/SKILL.md': createHash('sha256').update('swarm').digest('hex') }, parts: {} }),
    );
    const lists = [[join(dir, '.seed.json')], [join(dir, '.seed.json'), join(dir, 'swarm-seed.json')]];
    let call = 0;
    const manifestFiles = vi.fn(() => Promise.resolve(lists[Math.min(call++, 1)] ?? []));
    startSync({ ...h.deps, manifestFiles });
    const deps = h.engines[0]?.deps;
    await expect(deps?.collectFiles()).resolves.toHaveProperty(['automation:f:skills/s/SKILL.md']);
    await expect(deps?.collectFiles()).resolves.toEqual({});
    expect(manifestFiles).toHaveBeenCalledTimes(2);
  });

  it('builds the real engine by default', async () => {
    const h = harness();
    delete (h.deps as Partial<SyncDeps>).createEngine;
    startSync(h.deps);
    await expect(syncCalls()[CH.syncStatus]()).resolves.toEqual({ kind: 'off', cloud: 'none', resetElsewhere: false });
  });
});
