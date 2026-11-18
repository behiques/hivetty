import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  onApplyAppearance,
  onSyncStatusChanged,
  openSyncConflicts,
  readSyncStatus,
  reportAppearance,
  resetSync,
  setSyncGroup,
  setupSync,
  syncNow,
} from '@/lib/sync';

/** The renderer's door onto settings sync (HIVE-284): `null` or a no-op without the bridge, never a throw. */

const bridge = (sync: Record<string, unknown>): void => {
  (window as { hive?: unknown }).hive = { sync };
};

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
  vi.restoreAllMocks();
});

describe('without the bridge', () => {
  it('answers null or nothing', async () => {
    expect(await readSyncStatus()).toBeNull();
    expect(await setupSync('correct horse battery')).toBeNull();
    expect(await resetSync()).toBeNull();
    await expect(setSyncGroup({ group: 'automation', on: false })).resolves.toBeUndefined();
    await expect(syncNow()).resolves.toBeUndefined();
    await expect(openSyncConflicts()).resolves.toBeUndefined();
    await expect(reportAppearance({ density: 'compact' })).resolves.toBeUndefined();
    expect(onSyncStatusChanged(vi.fn())).toBeTypeOf('function');
    expect(onApplyAppearance(vi.fn())).toBeTypeOf('function');
  });
});

describe('with the bridge', () => {
  it('passes each call through', async () => {
    const sync = {
      status: vi.fn(() => Promise.resolve({ kind: 'off', cloud: 'none', resetElsewhere: false })),
      setup: vi.fn(() => Promise.resolve({ ok: true })),
      reset: vi.fn(() => Promise.resolve({ ok: true })),
      setGroup: vi.fn(() => Promise.resolve()),
      now: vi.fn(() => Promise.resolve()),
      openConflicts: vi.fn(() => Promise.resolve()),
      reportAppearance: vi.fn(() => Promise.resolve()),
      onStatus: vi.fn(() => () => undefined),
      onApplyAppearance: vi.fn(() => () => undefined),
    };
    bridge(sync);
    expect(await readSyncStatus()).toEqual({ kind: 'off', cloud: 'none', resetElsewhere: false });
    expect(await setupSync('correct horse battery')).toEqual({ ok: true });
    expect(sync.setup).toHaveBeenCalledWith('correct horse battery');
    expect(await resetSync()).toEqual({ ok: true });
    await setSyncGroup({ group: 'workspace', on: true });
    expect(sync.setGroup).toHaveBeenCalledWith({ group: 'workspace', on: true });
    await syncNow();
    await openSyncConflicts();
    await reportAppearance({ density: 'compact' });
    expect(sync.reportAppearance).toHaveBeenCalledWith({ density: 'compact' });
    const callback = vi.fn();
    onSyncStatusChanged(callback);
    onApplyAppearance(callback);
    expect(sync.onStatus).toHaveBeenCalledWith(callback);
    expect(sync.onApplyAppearance).toHaveBeenCalledWith(callback);
  });

  it('logs a refusal from main and answers null or nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fail = () => Promise.reject(new Error('no'));
    bridge({
      status: fail,
      setup: fail,
      reset: fail,
      setGroup: fail,
      now: fail,
      openConflicts: fail,
      reportAppearance: fail,
    });
    expect(await readSyncStatus()).toBeNull();
    expect(await setupSync('correct horse battery')).toBeNull();
    expect(await resetSync()).toBeNull();
    await setSyncGroup({ group: 'workspace', on: true });
    await syncNow();
    await openSyncConflicts();
    await reportAppearance({});
    expect(error).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(error.mock.calls)).not.toContain('correct horse battery');
  });
});
