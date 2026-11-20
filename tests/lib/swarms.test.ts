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
  andList,
  onCounts,
  skillUsers,
  swarmAskers,
  restoreSwarmItem,
  setSwarmItemEnabled,
  subscribeSwarms,
  swarmOwnerOf,
  swarmsSnapshot,
  takeSwarmInstallRequest,
} from '@/lib/swarms';

import type { AgentSummary } from '@shared/agent-contract';
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

describe('swarmOwnerOf (HIVE-453)', () => {
  const squad = installedSwarm({
    swarmId: 'sq1',
    title: 'Dev Squad',
    contents: {
      agents: [
        { name: 'builder', description: '', tools: [] },
        { name: 'acr', description: '', tools: [] },
      ],
      skills: [
        { name: 'tdd', description: '' },
        { name: 'plan', description: '' },
      ],
    },
    disabled: { agents: ['acr'], skills: [] },
  });
  const listing = swarmListing([swarmItem({ entry: null }), swarmItem({ installed: squad })]);

  it('answers the installed swarm that ships the name, on unless its list holds it', () => {
    expect(swarmOwnerOf(listing, 'agents', 'builder')).toEqual({
      swarmId: 'sq1',
      title: 'Dev Squad',
      bundled: false,
      on: true,
    });
    expect(swarmOwnerOf(listing, 'agents', 'acr')).toEqual({ swarmId: 'sq1', title: 'Dev Squad', bundled: false, on: false });
    expect(swarmOwnerOf(listing, 'skills', 'tdd')?.on).toBe(true);
  });

  it('flags a bundled owner', () => {
    const bundled = swarmListing([swarmItem({ installed: installedSwarm({ version: 'bundled' }) })]);
    expect(swarmOwnerOf(bundled, 'skills', 'tdd')?.bundled).toBe(true);
  });

  it('is null for a null listing, an unknown name, or the other kind', () => {
    expect(swarmOwnerOf(null, 'skills', 'tdd')).toBeNull();
    expect(swarmOwnerOf(listing, 'skills', 'mine')).toBeNull();
    expect(swarmOwnerOf(listing, 'skills', 'builder')).toBeNull();
  });

  it('reads an entry with no disabled field as everything on', () => {
    const old = { ...installedSwarm() } as Partial<typeof squad>;
    delete old.disabled;
    const legacy = swarmListing([swarmItem({ installed: old as typeof squad })]);
    expect(swarmOwnerOf(legacy, 'skills', 'tdd')?.on).toBe(true);
  });
});

describe('onCounts (HIVE-453)', () => {
  it('counts what is shipped minus what is off, ignoring off names no longer shipped', () => {
    const item = swarmItem({
      installed: installedSwarm({
        contents: {
          agents: [
            { name: 'builder', description: '', tools: [] },
            { name: 'acr', description: '', tools: [] },
          ],
          skills: [
            { name: 'tdd', description: '' },
            { name: 'plan', description: '' },
            { name: 'debug', description: '' },
          ],
        },
        disabled: { agents: ['acr'], skills: ['plan', 'gone'] },
      }),
    });
    expect(onCounts(item)).toEqual({ agentsOn: 1, agents: 2, skillsOn: 2, skills: 3 });
  });

  it('is all zeros for a swarm not installed', () => {
    expect(onCounts(swarmItem())).toEqual({ agentsOn: 0, agents: 0, skillsOn: 0, skills: 0 });
  });
});

describe('setSwarmItemEnabled (HIVE-453)', () => {
  it('sends the exact request, reloads and answers true', async () => {
    const h = bridge(INSTALLED);
    const setEnabled = vi.fn(() => Promise.resolve(installedSwarm()));
    setBridge({ ...h, setEnabled });

    expect(await setSwarmItemEnabled('standard', 'skills', 'tdd', false)).toBe(true);
    expect(setEnabled).toHaveBeenCalledWith({ swarmId: 'standard', kind: 'skills', name: 'tdd', enabled: false });
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it('answers false when main answers null, and still reloads', async () => {
    const h = bridge(INSTALLED);
    setBridge({ ...h, setEnabled: vi.fn(() => Promise.resolve(null)) });

    expect(await setSwarmItemEnabled('standard', 'agents', 'builder', true)).toBe(false);
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it('answers false on a rejection', async () => {
    const h = bridge(INSTALLED);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setBridge({ ...h, setEnabled: vi.fn(() => Promise.reject(new Error('no'))) });

    expect(await setSwarmItemEnabled('standard', 'agents', 'builder', true)).toBe(false);
  });

  it('answers false with no bridge', async () => {
    expect(await setSwarmItemEnabled('standard', 'agents', 'builder', true)).toBe(false);
  });
});

describe('restoreSwarmItem (HIVE-453)', () => {
  const withShipped = (reset: () => Promise<unknown>) => {
    const h = bridge(INSTALLED);
    (window as unknown as { hive: unknown }).hive = { swarms: h, shipped: { reset: vi.fn(reset) } };
    return { h, reset: (window as unknown as { hive: { shipped: { reset: ReturnType<typeof vi.fn> } } }).hive.shipped.reset };
  };

  it('resets the one item, reloads and answers null', async () => {
    const { h, reset } = withShipped(() => Promise.resolve([]));

    expect(await restoreSwarmItem('skills', 'plan')).toBeNull();
    expect(reset).toHaveBeenCalledWith({ kind: 'skills', name: 'plan' });
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it('answers the message on a rejection', async () => {
    withShipped(() => Promise.reject(new Error('Dev Squad does not ship plan')));

    expect(await restoreSwarmItem('skills', 'plan')).toBe('Dev Squad does not ship plan');
  });

  it('answers null with no bridge', async () => {
    expect(await restoreSwarmItem('skills', 'plan')).toBeNull();
  });
});

describe('who depends on a swarm item (HIVE-453)', () => {
  const agent = (name: string, over: Partial<AgentSummary> = {}): AgentSummary => ({
    name,
    description: '',
    icon: 'ph-robot',
    status: 'sleeping',
    wake: { on: [] },
    mcp: [],
    tools: [],
    skills: [],
    rotateAfter: 50,
    runs: [],
    ...over,
  });
  const squad = (off: string[] = []) =>
    swarmListing([
      swarmItem({
        installed: installedSwarm({
          swarmId: 'sq1',
          title: 'Dev Squad',
          contents: {
            agents: ['builder', 'fixer', 'shipper', 'acr'].map((name) => ({ name, description: '', tools: [] })),
            skills: [{ name: 'tdd', description: '' }],
          },
          disabled: { agents: off, skills: [] },
        }),
      }),
      swarmItem({
        installed: installedSwarm({
          swarmId: 'other',
          title: 'Other',
          contents: { agents: [{ name: 'stranger', description: '', tools: [] }], skills: [] },
        }),
      }),
    ]);

  it('skillUsers names the enabled, valid agents that list the skill', () => {
    const agents = [
      agent('builder', { skills: ['tdd', 'plan'] }),
      agent('fixer', { skills: ['tdd'] }),
      agent('acr', { skills: ['tdd'] }),
      agent('broken', { skills: ['tdd'], invalid: 'bad yaml' }),
      agent('mine', { skills: ['tdd'] }),
      agent('shipper', { skills: [] }),
    ];
    expect(skillUsers(squad(['acr']), agents, 'tdd')).toEqual(['builder', 'fixer', 'mine']);
    expect(skillUsers(null, agents, 'nothing')).toEqual([]);
  });

  it('swarmAskers names the enabled agents of the same swarm in asksFrom, ignoring sess-*', () => {
    const agents = [
      agent('builder'),
      agent('fixer', { asksFrom: ['shipper'] }),
      agent('shipper', { asksFrom: ['sess-*', 'builder', 'stranger', 'mine'] }),
      agent('acr'),
      agent('stranger'),
      agent('mine'),
    ];
    expect(swarmAskers(squad(), agents, 'shipper')).toEqual(['builder']);
    expect(swarmAskers(squad(), agents, 'fixer')).toEqual(['shipper']);
    expect(swarmAskers(squad(), agents, 'acr')).toEqual([]);
    expect(swarmAskers(squad(['builder']), agents, 'shipper')).toEqual([]);
    expect(swarmAskers(squad(), agents, 'mine')).toEqual([]);
  });

  it('swarmAskers skips an asker whose definition is invalid', () => {
    const agents = [agent('builder', { invalid: 'bad' }), agent('shipper', { asksFrom: ['builder'] })];
    expect(swarmAskers(squad(), agents, 'shipper')).toEqual([]);
  });

  it('andList joins names the way a sentence does', () => {
    expect(andList(['builder'])).toBe('builder');
    expect(andList(['builder', 'fixer'])).toBe('builder and fixer');
    expect(andList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
