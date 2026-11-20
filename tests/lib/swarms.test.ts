import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkSwarms,
  dismissSwarmFailure,
  installSwarm,
  loadSwarms,
  onSwarmInstallRequested,
  providerOf,
  removeSwarm,
  resetSwarmsState,
  setSwarmAutoUpdate,
  devSquadOf,
  subscribeSwarms,
  swarmsSnapshot,
  takeSwarmInstallRequest,
} from '@/lib/swarms';

import type { SwarmListing, SwarmsChanged } from '@shared/swarm-contract';

import { installedSwarm, swarmEntry, swarmItem, swarmListing } from '../support/swarms';

const setBridge = (swarms: Record<string, unknown> | undefined): void => {
  (window as unknown as { hive?: unknown }).hive = swarms === undefined ? undefined : { swarms };
};

const NOT_INSTALLED = swarmListing([swarmItem()]);
const INSTALLED = swarmListing([swarmItem({ installed: installedSwarm() })]);

/** A bridge whose `list` answers `listing`, with every verb a spy. */
function bridge(listing: SwarmListing = NOT_INSTALLED) {
  let push: (event: SwarmsChanged) => void = () => undefined;
  const spies = {
    list: vi.fn(() => Promise.resolve(listing)),
    install: vi.fn(() => Promise.resolve({ ok: true, installed: installedSwarm() })),
    remove: vi.fn(() => Promise.resolve({ ok: true })),
    setAutoUpdate: vi.fn(() => Promise.resolve(installedSwarm())),
    check: vi.fn(() => Promise.resolve(INSTALLED)),
    onChanged: vi.fn((callback: (event: SwarmsChanged) => void) => {
      push = callback;
      return () => undefined;
    }),
  };
  setBridge(spies);
  return { ...spies, push: (event: SwarmsChanged) => push(event) };
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

beforeEach(() => {
  setBridge(undefined);
  resetSwarmsState();
  vi.restoreAllMocks();
});

describe('without a bridge (the browser target)', () => {
  it('resolves every verb and keeps listing null', async () => {
    await loadSwarms();
    await checkSwarms();
    expect(await installSwarm('standard')).toBe(false);
    expect(await removeSwarm('standard')).toBeNull();
    await setSwarmAutoUpdate('standard', false);

    expect(swarmsSnapshot()).toEqual({
      listing: null,
      busy: new Set(),
      removing: new Set(),
      failures: new Map(),
      lastUpdate: null,
    });
  });
});

describe('loadSwarms', () => {
  it('stores the listing and tells every subscriber once', async () => {
    bridge();
    const listener = vi.fn();
    subscribeSwarms(listener);

    await loadSwarms();

    expect(swarmsSnapshot().listing).toBe(NOT_INSTALLED);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribes to swarms:changed exactly once across two loads', async () => {
    const h = bridge();

    await loadSwarms();
    await loadSwarms();

    expect(h.onChanged).toHaveBeenCalledTimes(1);
  });

  it('reloads on every change event, and an update event sets the last-update line', async () => {
    const h = bridge();
    await loadSwarms();
    h.list.mockResolvedValue(INSTALLED);

    h.push({ updated: null });
    await flush();
    expect(swarmsSnapshot().listing).toBe(INSTALLED);
    expect(swarmsSnapshot().lastUpdate).toBeNull();

    h.push({ updated: { swarmId: 'standard', title: 'Standard', version: '1.5.0' } });
    await flush();
    expect(h.list).toHaveBeenCalledTimes(3);
    expect(swarmsSnapshot().lastUpdate).toEqual({ title: 'Standard', version: '1.5.0' });
  });

  it('keeps the last listing when a read fails', async () => {
    const h = bridge();
    await loadSwarms();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.list.mockRejectedValue(new Error('gone'));

    await loadSwarms();

    expect(swarmsSnapshot().listing).toBe(NOT_INSTALLED);
  });

  it('replaces the snapshot object on a change, never mutates it', async () => {
    bridge();
    const before = swarmsSnapshot();

    await loadSwarms();

    expect(swarmsSnapshot()).not.toBe(before);
    expect(before.listing).toBeNull();
  });
});

describe('installSwarm', () => {
  it('marks the id busy during the call, then reloads and answers true', async () => {
    const h = bridge();
    let release: () => void = () => undefined;
    h.install.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true, installed: installedSwarm() });
      }),
    );

    const done = installSwarm('standard');
    expect(swarmsSnapshot().busy.has('standard')).toBe(true);
    expect(h.install).toHaveBeenCalledWith({ swarmId: 'standard' });
    release();

    expect(await done).toBe(true);
    expect(swarmsSnapshot().busy.has('standard')).toBe(false);
    expect(h.list).toHaveBeenCalled();
  });

  it('stores a failed first install, then a later success clears it', async () => {
    const h = bridge();
    await loadSwarms();
    const failure = { code: 'no_access', message: 'You no longer have access.' } as const;
    h.install.mockResolvedValueOnce({ ok: false, failure } as never);

    expect(await installSwarm('standard')).toBe(false);
    expect(swarmsSnapshot().failures.get('standard')).toEqual(failure);

    expect(await installSwarm('standard')).toBe(true);
    expect(swarmsSnapshot().failures.has('standard')).toBe(false);
  });

  it('dismissSwarmFailure drops a stored failure', async () => {
    const h = bridge();
    await loadSwarms();
    h.install.mockResolvedValueOnce({ ok: false, failure: { code: 'failed', message: 'No.' } } as never);
    await installSwarm('standard');
    const listener = vi.fn();
    subscribeSwarms(listener);

    dismissSwarmFailure('standard');

    expect(swarmsSnapshot().failures.has('standard')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not store a failed update of an installed swarm: its lastError comes back in the listing', async () => {
    const h = bridge(INSTALLED);
    await loadSwarms();
    h.install.mockResolvedValueOnce({ ok: false, failure: { code: 'failed', message: 'No.' } } as never);

    expect(await installSwarm('standard')).toBe(false);

    expect(swarmsSnapshot().failures.size).toBe(0);
  });

  it('stores a rejected bridge call as a failed install and clears busy', async () => {
    const h = bridge();
    await loadSwarms();
    h.install.mockRejectedValueOnce(new Error('IPC broke'));

    expect(await installSwarm('standard')).toBe(false);

    expect(swarmsSnapshot().busy.size).toBe(0);
    expect(swarmsSnapshot().failures.get('standard')).toEqual({ code: 'failed', message: 'IPC broke' });
  });
});

describe('a rejected call on an installed swarm', () => {
  it('is held, since main recorded nothing the listing could bring back', async () => {
    const h = bridge(swarmListing([swarmItem({ installed: installedSwarm(), update: { target: '1.5.0', updating: false } })]));
    await loadSwarms();
    h.install.mockRejectedValueOnce(new Error('IPC broke'));

    expect(await installSwarm('standard')).toBe(false);

    expect(swarmsSnapshot().failures.get('standard')).toEqual({ code: 'failed', message: 'IPC broke' });
  });

  it('is dropped once the listing shows no update pending for it', async () => {
    const h = bridge(swarmListing([swarmItem({ installed: installedSwarm(), update: { target: '1.5.0', updating: false } })]));
    await loadSwarms();
    h.install.mockRejectedValueOnce(new Error('IPC broke'));
    await installSwarm('standard');

    h.list.mockResolvedValue(INSTALLED);
    await loadSwarms();

    expect(swarmsSnapshot().failures.has('standard')).toBe(false);
  });
});

describe('removeSwarm', () => {
  it('marks busy, removes, reloads and answers null', async () => {
    const h = bridge(INSTALLED);
    const seen: boolean[] = [];
    subscribeSwarms(() => seen.push(swarmsSnapshot().busy.has('standard')));

    const removing: boolean[] = [];
    subscribeSwarms(() => removing.push(swarmsSnapshot().removing.has('standard')));

    expect(await removeSwarm('standard')).toBeNull();

    expect(removing[0]).toBe(true);
    expect(swarmsSnapshot().removing.size).toBe(0);
    expect(h.remove).toHaveBeenCalledWith({ swarmId: 'standard' });
    expect(seen[0]).toBe(true);
    expect(swarmsSnapshot().busy.size).toBe(0);
    expect(h.list).toHaveBeenCalled();
  });

  it("answers the failure's sentence", async () => {
    const h = bridge(INSTALLED);
    h.remove.mockResolvedValueOnce({ ok: false, failure: { code: 'failed', message: 'Busy.' } } as never);

    expect(await removeSwarm('standard')).toBe('Busy.');
  });

  it("answers a rejected call's message and clears busy", async () => {
    const h = bridge(INSTALLED);
    h.remove.mockRejectedValueOnce(new Error('IPC broke'));

    expect(await removeSwarm('standard')).toBe('IPC broke');
    expect(swarmsSnapshot().busy.size).toBe(0);
  });
});

describe('setSwarmAutoUpdate and checkSwarms', () => {
  it('setSwarmAutoUpdate calls the bridge then reloads', async () => {
    const h = bridge(INSTALLED);

    await setSwarmAutoUpdate('standard', false);

    expect(h.setAutoUpdate).toHaveBeenCalledWith({ swarmId: 'standard', autoUpdate: false });
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(swarmsSnapshot().listing).toBe(INSTALLED);
  });

  it('setSwarmAutoUpdate survives a rejected call', async () => {
    const h = bridge(INSTALLED);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.setAutoUpdate.mockRejectedValueOnce(new Error('no'));

    await setSwarmAutoUpdate('standard', true);

    expect(swarmsSnapshot().listing).toBe(INSTALLED);
  });

  it('checkSwarms stores the listing check answers', async () => {
    const h = bridge();

    await checkSwarms();

    expect(h.check).toHaveBeenCalledTimes(1);
    expect(swarmsSnapshot().listing).toBe(INSTALLED);
  });

  it('checkSwarms keeps the listing when the check fails', async () => {
    const h = bridge();
    await loadSwarms();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.check.mockRejectedValueOnce(new Error('offline'));

    await checkSwarms();

    expect(swarmsSnapshot().listing).toBe(NOT_INSTALLED);
  });
});

describe('the install link wrappers (HIVE-442)', () => {
  it('takeSwarmInstallRequest answers what the bridge holds', async () => {
    const takeInstallRequest = vi.fn(() => Promise.resolve('a1'));
    setBridge({ takeInstallRequest });

    await expect(takeSwarmInstallRequest()).resolves.toBe('a1');
    expect(takeInstallRequest).toHaveBeenCalledTimes(1);
  });

  it('onSwarmInstallRequested subscribes through the bridge and hands back its disposer', () => {
    const dispose = vi.fn();
    const onInstallRequested = vi.fn(() => dispose);
    setBridge({ onInstallRequested });
    const callback = vi.fn();

    const unsubscribe = onSwarmInstallRequested(callback);

    expect(onInstallRequested).toHaveBeenCalledWith(callback);
    unsubscribe();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('answers null and a no-op with no bridge', async () => {
    setBridge(undefined);

    await expect(takeSwarmInstallRequest()).resolves.toBeNull();
    expect(() => onSwarmInstallRequested(vi.fn())()).not.toThrow();
  });
});

describe('providerOf', () => {
  const workOn = { name: 'work-on', description: 'Work a ticket.' };
  const community = swarmEntry({ id: 'cmty1', slug: 'extras', kind: 'community', title: 'Extras', skills: [workOn] });
  const standard = swarmEntry({ id: 'std1', skills: [workOn] });

  it('names the native row that provides a skill', () => {
    expect(providerOf(swarmListing([swarmItem({ entry: standard })]), 'skill', 'work-on')).toEqual({
      id: 'std1',
      title: 'Standard',
    });
  });

  it('names the row that provides an agent', () => {
    expect(providerOf(swarmListing([swarmItem({ entry: standard })]), 'agent', 'builder')).toEqual({
      id: 'std1',
      title: 'Standard',
    });
  });

  it('does not match a skill name against agents', () => {
    expect(providerOf(swarmListing([swarmItem({ entry: standard })]), 'agent', 'work-on')).toBeNull();
  });

  it('prefers a native row over an earlier community row', () => {
    const listing = swarmListing([swarmItem({ entry: community }), swarmItem({ entry: standard })]);
    expect(providerOf(listing, 'skill', 'work-on')).toEqual({ id: 'std1', title: 'Standard' });
  });

  it('takes the listing order among non-native rows', () => {
    const other = swarmEntry({ id: 'cmty2', slug: 'more', kind: 'community', title: 'More', skills: [workOn] });
    const listing = swarmListing([swarmItem({ entry: community }), swarmItem({ entry: other })]);
    expect(providerOf(listing, 'skill', 'work-on')).toEqual({ id: 'cmty1', title: 'Extras' });
  });

  it('is null when the only provider is installed', () => {
    const listing = swarmListing([swarmItem({ entry: standard, installed: installedSwarm({ swarmId: 'std1' }) })]);
    expect(providerOf(listing, 'skill', 'work-on')).toBeNull();
  });

  it('skips rows with no registry entry', () => {
    expect(providerOf(swarmListing([swarmItem({ entry: null, installed: installedSwarm() })]), 'skill', 'tdd')).toBeNull();
  });

  it('is null for a null listing or no match', () => {
    expect(providerOf(null, 'skill', 'work-on')).toBeNull();
    expect(providerOf(swarmListing([swarmItem({ entry: standard })]), 'skill', 'nope')).toBeNull();
  });
});

describe('devSquadOf', () => {
  it('answers the native dev-squad row, not installed', () => {
    const listing = swarmListing([
      swarmItem({ entry: swarmEntry({ id: 'cmty1', slug: 'dev-squad', kind: 'community' }) }),
      swarmItem({ entry: swarmEntry({ id: 'std1', slug: 'dev-squad' }) }),
    ]);
    expect(devSquadOf(listing)).toEqual({ id: 'std1', installed: false });
  });

  it('answers the native dev-squad row, installed', () => {
    const listing = swarmListing([
      swarmItem({ entry: swarmEntry({ id: 'std1', slug: 'dev-squad' }), installed: installedSwarm({ swarmId: 'std1' }) }),
    ]);
    expect(devSquadOf(listing)).toEqual({ id: 'std1', installed: true });
  });

  it('is null with no native dev-squad row or no listing', () => {
    // HIVE-448: Standard was renamed before any release carried it; a row still named standard is not the one.
    expect(devSquadOf(swarmListing([swarmItem({ entry: swarmEntry({ slug: 'standard' }) })]))).toBeNull();
    expect(devSquadOf(swarmListing([swarmItem({ entry: swarmEntry({ slug: 'other' }) })]))).toBeNull();
    expect(devSquadOf(swarmListing([]))).toBeNull();
    expect(devSquadOf(null)).toBeNull();
  });
});
