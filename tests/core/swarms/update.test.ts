// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstalledSwarm, SwarmEntry, SwarmInstallResult } from '@shared/swarm-contract';

import type { RegistryRead } from '../../../core/swarms/registry';
import { CHECK_EVERY_MS, createSwarmUpdater, type SwarmUpdaterDeps } from '../../../core/swarms/update';

const rowFor = (overrides: Partial<SwarmEntry> = {}): SwarmEntry => ({
  id: 'a1',
  slug: 'standard',
  kind: 'native',
  title: 'Standard',
  description: 'Ticket to merge.',
  publisher: 'HiveTTY',
  tags: [],
  version: '1.4.0',
  updatedAt: '2026-11-19T00:00:00Z',
  installs: 0,
  agents: [],
  skills: [],
  repoUrl: 'https://github.com/o/r',
  folder: 'standard',
  commit: 'b'.repeat(40),
  access: 'token',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
  ...overrides,
});

const heldFor = (overrides: Partial<InstalledSwarm> = {}): InstalledSwarm => ({
  swarmId: 'a1',
  slug: 'standard',
  kind: 'native',
  org: null,
  repoUrl: 'https://github.com/o/r',
  folder: 'standard',
  version: '1.3.0',
  commit: 'a'.repeat(40),
  installedAt: '2026-11-19T12:00:00.000Z',
  autoUpdate: true,
  lastError: null,
  title: 'Standard',
  description: 'Ticket to merge.',
  contents: { agents: [], skills: [] },
  ...overrides,
});

const org = { id: 'o1', name: 'Acme' };

interface Harness {
  deps: {
    registry: ReturnType<typeof vi.fn<SwarmUpdaterDeps['registry']>>;
    installed: ReturnType<typeof vi.fn<SwarmUpdaterDeps['installed']>>;
    newestVersion: ReturnType<typeof vi.fn<SwarmUpdaterDeps['newestVersion']>>;
    apply: ReturnType<typeof vi.fn<SwarmUpdaterDeps['apply']>>;
    runsLive: ReturnType<typeof vi.fn<SwarmUpdaterDeps['runsLive']>>;
    changed: ReturnType<typeof vi.fn<SwarmUpdaterDeps['changed']>>;
    notify: ReturnType<typeof vi.fn<SwarmUpdaterDeps['notify']>>;
  };
}

const appliedAt = (entry: SwarmEntry, version: string): SwarmInstallResult => ({
  ok: true,
  installed: heldFor({ swarmId: entry.id, title: entry.title, version }),
});

function harness(
  rows: SwarmEntry[],
  installed: InstalledSwarm[],
  source: RegistryRead['source'] = 'cloud',
): Harness['deps'] {
  const installedNow = vi.fn<SwarmUpdaterDeps['installed']>().mockResolvedValue(installed);
  return {
    registry: vi.fn<SwarmUpdaterDeps['registry']>().mockResolvedValue({ source, swarms: rows }),
    installed: installedNow,
    newestVersion: vi.fn<SwarmUpdaterDeps['newestVersion']>().mockResolvedValue(null),
    // As the engine does: the guard is asked with what is installed when the install's turn comes.
    apply: vi.fn<SwarmUpdaterDeps['apply']>(async (entry, onlyIf) => {
      const now = (await installedNow()).find((held) => held.swarmId === entry.id) ?? null;
      if (onlyIf !== undefined && !onlyIf(now)) return null;
      return appliedAt(entry, entry.kind === 'organization' ? (entry.pinnedVersion ?? '9.9.9') : (entry.version ?? ''));
    }),
    runsLive: vi.fn<SwarmUpdaterDeps['runsLive']>().mockReturnValue(false),
    changed: vi.fn<SwarmUpdaterDeps['changed']>(),
    notify: vi.fn<SwarmUpdaterDeps['notify']>(),
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('check', () => {
  it('applies a newer native version at once, marks it updating meanwhile, and notifies', async () => {
    const row = rowFor();
    const deps = harness([row], [heldFor()]);
    const gate = deferred<SwarmInstallResult>();
    deps.apply.mockReturnValue(gate.promise);
    const updater = createSwarmUpdater(deps);

    const done = updater.check();
    await flush();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(deps.apply).toHaveBeenCalledWith(row, expect.any(Function));
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: true });
    expect(deps.changed).toHaveBeenCalled();

    gate.resolve(appliedAt(row, '1.4.0'));
    await done;
    expect(deps.notify).toHaveBeenCalledWith({ swarmId: 'a1', title: 'Standard', version: '1.4.0' });
    expect(updater.pending('a1')).toBeNull();
  });

  it('updates a bundled Standard like any other version: pending, then applied (HIVE-447)', async () => {
    const row = rowFor({ version: '1.0.1' });
    const deps = harness([row], [heldFor({ version: 'bundled' })]);
    const updater = createSwarmUpdater(deps);

    await updater.check();

    expect(deps.apply).toHaveBeenCalledWith(row, expect.any(Function));
    expect(deps.notify).toHaveBeenCalledWith({ swarmId: 'a1', title: 'Standard', version: '1.0.1' });
  });

  it('holds a bundled Standard pending at the registry version while a run is live (HIVE-447)', async () => {
    const deps = harness([rowFor({ version: '1.0.1' })], [heldFor({ version: 'bundled' })]);
    deps.runsLive.mockReturnValue(true);
    const updater = createSwarmUpdater(deps);

    await updater.check();

    expect(updater.pending('a1')).toEqual({ target: '1.0.1', updating: false });
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('waits for agent runs, then the idle signal applies it without reading the registry again', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    deps.runsLive.mockReturnValue(true);
    const updater = createSwarmUpdater(deps);

    await updater.check();
    expect(deps.apply).not.toHaveBeenCalled();
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: false });
    expect(deps.changed).toHaveBeenCalledTimes(1);

    deps.runsLive.mockReturnValue(false);
    await updater.idle();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(deps.registry).toHaveBeenCalledTimes(1);
  });

  it('never applies a community swarm on its own', async () => {
    const deps = harness([rowFor({ kind: 'community', access: 'anonymous' })], [heldFor({ kind: 'community', autoUpdate: true })]);
    const updater = createSwarmUpdater(deps);

    await updater.check();
    await updater.idle();
    expect(deps.apply).not.toHaveBeenCalled();
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: false });
  });

  it('leaves a native swarm with the switch off pending', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);

    await updater.check();
    expect(deps.apply).not.toHaveBeenCalled();
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: false });
  });

  it('applies an organization pin over the switch, even to a lower version, without asking Git', async () => {
    const row = rowFor({ kind: 'organization', org, policy: 'pinned', pinnedVersion: '0.4.1', version: null, commit: null });
    const deps = harness([row], [heldFor({ kind: 'organization', org, version: '0.5.0', autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);

    await updater.check();
    expect(deps.apply).toHaveBeenCalledWith(row, expect.any(Function));
    expect(deps.newestVersion).not.toHaveBeenCalled();
  });

  describe('an organization swarm under the latest policy', () => {
    const row = rowFor({ kind: 'organization', org, policy: 'latest', version: null, commit: null });
    const held = heldFor({ kind: 'organization', org, version: '1.0.0', autoUpdate: false });

    it('targets the newest tag Git finds', async () => {
      const deps = harness([row], [held]);
      deps.newestVersion.mockResolvedValue('1.2.0');
      const updater = createSwarmUpdater(deps);

      await updater.check();
      expect(deps.newestVersion).toHaveBeenCalledWith('https://github.com/o/r', 'standard');
      expect(updater.pending('a1')).toEqual({ target: '1.2.0', updating: false });
    });

    it('has nothing pending when the newest tag is the installed one', async () => {
      const deps = harness([row], [held]);
      deps.newestVersion.mockResolvedValue('1.0.0');
      const updater = createSwarmUpdater(deps);

      await updater.check();
      expect(updater.pending('a1')).toBeNull();
    });

    it('keeps what was pending when the repository cannot be reached', async () => {
      const deps = harness([row], [held]);
      deps.newestVersion.mockResolvedValueOnce('1.2.0').mockRejectedValueOnce(new Error('offline'));
      const updater = createSwarmUpdater(deps);

      await updater.check();
      await updater.check();
      expect(updater.pending('a1')).toEqual({ target: '1.2.0', updating: false });
    });

    it('still checks the other swarms when one repository cannot be reached', async () => {
      const other = rowFor({ id: 'b1' });
      const deps = harness([row, other], [held, heldFor({ swarmId: 'b1', autoUpdate: false })]);
      deps.newestVersion.mockRejectedValue(new Error('offline'));
      const updater = createSwarmUpdater(deps);

      await updater.check();
      expect(updater.pending('b1')).toEqual({ target: '1.4.0', updating: false });
    });
  });

  it('keeps a failed update pending, leaves it to the next check, and does not notify', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    deps.apply.mockResolvedValue({ ok: false, failure: { code: 'offline', message: 'no' } });
    const updater = createSwarmUpdater(deps);

    await updater.check();
    expect(deps.notify).not.toHaveBeenCalled();
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: false });

    await updater.idle();
    expect(deps.apply).toHaveBeenCalledTimes(1);

    await updater.check();
    expect(deps.apply).toHaveBeenCalledTimes(2);
  });

  it('clears a swarm that left a cloud registry', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);
    await updater.check();
    expect(updater.pending('a1')).not.toBeNull();
    deps.changed.mockClear();

    deps.registry.mockResolvedValue({ source: 'cloud', swarms: [] });
    await updater.check();
    expect(updater.pending('a1')).toBeNull();
    expect(deps.changed).toHaveBeenCalledTimes(1);
  });

  it.each<RegistryRead['source']>(['cache', 'none'])('changes nothing on a %s read', async (source) => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);
    await updater.check();
    deps.installed.mockClear();
    deps.changed.mockClear();

    deps.registry.mockResolvedValue({ source, swarms: [] });
    await updater.check();
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: false });
    expect(deps.installed).not.toHaveBeenCalled();
    expect(deps.changed).not.toHaveBeenCalled();
  });

  it('clears a pending update once the installed version reaches the target', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);
    await updater.check();

    deps.installed.mockResolvedValue([heldFor({ autoUpdate: false, version: '1.4.0' })]);
    await updater.check();
    expect(updater.pending('a1')).toBeNull();
  });

  it('clears a pending update when the row has no version', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);
    await updater.check();

    deps.registry.mockResolvedValue({ source: 'cloud', swarms: [rowFor({ version: null })] });
    await updater.check();
    expect(updater.pending('a1')).toBeNull();
  });

  it('says nothing changed when a check finds what it already held', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);
    await updater.check();
    deps.changed.mockClear();

    await updater.check();
    expect(deps.changed).not.toHaveBeenCalled();
  });

  it('joins a check already running', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);

    await Promise.all([updater.check(), updater.check()]);
    expect(deps.registry).toHaveBeenCalledTimes(1);
  });

  it('runs an idle signal that arrives during a check once the check ends', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    const gate = deferred<RegistryRead>();
    deps.registry.mockReturnValue(gate.promise);
    deps.runsLive.mockReturnValueOnce(true).mockReturnValue(false);
    const updater = createSwarmUpdater(deps);

    const checking = updater.check();
    const idling = updater.idle();
    gate.resolve({ source: 'cloud', swarms: [rowFor()] });
    await Promise.all([checking, idling]);
    await flush();
    // The check found the run live and applied nothing; the queued idle found it ended.
    expect(deps.runsLive).toHaveBeenCalledTimes(2);
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(deps.registry).toHaveBeenCalledTimes(1);
  });

  it('swallows a registry that rejects, and runs the next check', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    deps.registry.mockRejectedValueOnce(new Error('boom'));
    const updater = createSwarmUpdater(deps);

    await expect(updater.check()).resolves.toBeUndefined();
    await updater.check();
    expect(deps.registry).toHaveBeenCalledTimes(2);
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: false });
  });

  it('swallows an installed list that rejects', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    deps.installed.mockRejectedValueOnce(new Error('boom'));
    const updater = createSwarmUpdater(deps);

    await expect(updater.check()).resolves.toBeUndefined();
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('survives an apply that rejects, and the next check rewrites it as not updating', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    deps.apply.mockRejectedValueOnce(new Error('broke its contract'));
    const updater = createSwarmUpdater(deps);

    await expect(updater.check()).resolves.toBeUndefined();
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: true });
    deps.changed.mockClear();

    deps.runsLive.mockReturnValue(true);
    await updater.check();
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: false });
    expect(deps.changed).toHaveBeenCalledTimes(1); // the renderer stops showing it as updating
  });

  it('stops applying when a run starts between two installs', async () => {
    const deps = harness([rowFor(), rowFor({ id: 'b1' })], [heldFor(), heldFor({ swarmId: 'b1' })]);
    deps.runsLive.mockReturnValueOnce(false).mockReturnValue(true);
    const updater = createSwarmUpdater(deps);

    await updater.check();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(updater.pending('b1')).toEqual({ target: '1.4.0', updating: false });
  });
});

describe('what changed since the check', () => {
  it('runs a check that arrives during an idle job once that job ends', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    deps.runsLive.mockReturnValue(true);
    const updater = createSwarmUpdater(deps);
    await updater.check();
    const gate = deferred<InstalledSwarm[]>();
    deps.installed.mockReturnValueOnce(gate.promise);

    const idling = updater.idle();
    const checking = updater.check();
    gate.resolve([heldFor()]);
    await Promise.all([idling, checking]);
    expect(deps.registry).toHaveBeenCalledTimes(2);
  });

  it('runs a check again when the running one already read the installed list', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    deps.runsLive.mockReturnValue(false);
    const gate = deferred<InstalledSwarm[]>();
    deps.installed.mockReturnValueOnce(gate.promise);
    const updater = createSwarmUpdater(deps);

    const first = updater.check();
    await flush(); // the first check is waiting on the installed list it already asked for
    deps.installed.mockResolvedValue([heldFor({ autoUpdate: true })]); // the switch was turned on meanwhile
    const second = updater.check();
    gate.resolve([heldFor({ autoUpdate: false })]);
    await Promise.all([first, second]);

    expect(deps.registry).toHaveBeenCalledTimes(2);
    expect(deps.apply).toHaveBeenCalled();
  });

  it('does not apply an update whose switch was turned off since the check, even when the next check is offline', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: true })]);
    deps.runsLive.mockReturnValue(true);
    const updater = createSwarmUpdater(deps);
    await updater.check();

    deps.installed.mockResolvedValue([heldFor({ autoUpdate: false })]);
    deps.registry.mockResolvedValue({ source: 'cache', swarms: [rowFor()] });
    await updater.check();
    deps.runsLive.mockReturnValue(false);
    await updater.idle();

    expect(deps.apply).not.toHaveBeenCalled();
    expect(updater.pending('a1')).toEqual({ target: '1.4.0', updating: false });
  });

  it('forgets a pending update whose swarm is no longer installed, at the next check', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);
    await updater.check();
    deps.changed.mockClear();

    deps.installed.mockResolvedValue([]);
    await updater.check();
    expect(updater.pending('a1')).toBeNull();
    expect(deps.changed).toHaveBeenCalled();
  });

  it('never reinstalls a swarm removed after the check found its update', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    deps.runsLive.mockReturnValue(true);
    const updater = createSwarmUpdater(deps);
    await updater.check();
    deps.changed.mockClear();

    deps.installed.mockResolvedValue([]);
    deps.runsLive.mockReturnValue(false);
    await updater.idle();

    expect(deps.apply).not.toHaveBeenCalled();
    expect(updater.pending('a1')).toBeNull();
    expect(deps.changed).toHaveBeenCalledTimes(1);
  });

  it('drops a pending update a clicked install already reached', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    deps.runsLive.mockReturnValue(true);
    const updater = createSwarmUpdater(deps);
    await updater.check();

    deps.installed.mockResolvedValue([heldFor({ version: '1.4.0' })]);
    deps.runsLive.mockReturnValue(false);
    await updater.idle();

    expect(deps.apply).not.toHaveBeenCalled();
    expect(updater.pending('a1')).toBeNull();
  });

  describe('while an earlier swarm installs', () => {
    const rows = [rowFor(), rowFor({ id: 'b1', slug: 'other', title: 'Other' })];
    const both = (b1: Partial<InstalledSwarm> = {}): InstalledSwarm[] => [
      heldFor(),
      heldFor({ swarmId: 'b1', slug: 'other', title: 'Other', ...b1 }),
    ];

    async function midway(after: InstalledSwarm[]): Promise<{ deps: ReturnType<typeof harness>; updater: ReturnType<typeof createSwarmUpdater> }> {
      const deps = harness(rows, both());
      const first = deferred<SwarmInstallResult>();
      const real = deps.apply.getMockImplementation();
      deps.apply.mockImplementationOnce(() => first.promise);
      if (real !== undefined) deps.apply.mockImplementation(real);
      const updater = createSwarmUpdater(deps);
      const done = updater.check();
      await flush();
      expect(deps.apply).toHaveBeenCalledTimes(1);

      deps.installed.mockResolvedValue(after);
      first.resolve(appliedAt(rows[0] as SwarmEntry, '1.4.0'));
      await done;
      return { deps, updater };
    }

    it('never reinstalls a swarm removed meanwhile', async () => {
      const { deps, updater } = await midway([heldFor({ version: '1.4.0' })]);

      expect(deps.notify).toHaveBeenCalledTimes(1);
      expect(deps.notify).not.toHaveBeenCalledWith(expect.objectContaining({ swarmId: 'b1' }));
      expect(updater.pending('b1')).toBeNull();
    });

    it('never updates a swarm switched off meanwhile, and leaves it pending', async () => {
      const after = both({ autoUpdate: false });
      after[0] = heldFor({ version: '1.4.0' });
      const { deps, updater } = await midway(after);

      expect(deps.notify).not.toHaveBeenCalledWith(expect.objectContaining({ swarmId: 'b1' }));
      expect(updater.pending('b1')).toEqual({ target: '1.4.0', updating: false });
    });

    it('never reinstalls a swarm whose removal lands between the read and the install', async () => {
      const deps = harness([rowFor()], [heldFor()]);
      deps.apply.mockImplementation((entry, onlyIf) => Promise.resolve(onlyIf?.(null) === false ? null : appliedAt(entry, '1.4.0')));
      const updater = createSwarmUpdater(deps);

      await updater.check();

      expect(deps.notify).not.toHaveBeenCalled();
      expect(updater.pending('a1')).toBeNull();
    });
  });

  it('says the list changed once a failed update stops showing as updating', async () => {
    const deps = harness([rowFor()], [heldFor()]);
    deps.apply.mockResolvedValue({ ok: false, failure: { code: 'offline', message: 'no' } });
    const updater = createSwarmUpdater(deps);
    const seen: unknown[] = [];
    deps.changed.mockImplementation(() => seen.push(updater.pending('a1')));

    await updater.check();

    expect(seen.at(-1)).toEqual({ target: '1.4.0', updating: false });
  });

  it('treats a pinned policy on a native row as the switch, not as a pin', async () => {
    const deps = harness([rowFor({ policy: 'pinned' })], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);

    await updater.check();
    expect(deps.apply).not.toHaveBeenCalled();
  });
});

describe('clear', () => {
  it('drops a pending update', async () => {
    const deps = harness([rowFor()], [heldFor({ autoUpdate: false })]);
    const updater = createSwarmUpdater(deps);
    await updater.check();

    updater.clear('a1');
    expect(updater.pending('a1')).toBeNull();
  });
});

describe('the six-hour timer', () => {
  it('checks every six hours until stopped, with one timer however often it is started', async () => {
    const deps = harness([], []);
    const updater = createSwarmUpdater(deps);

    updater.start();
    updater.start();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(deps.registry).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(deps.registry).toHaveBeenCalledTimes(2);

    updater.stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(deps.registry).toHaveBeenCalledTimes(2);
  });

  it('is six hours', () => {
    expect(CHECK_EVERY_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('stops quietly when it never started', () => {
    expect(() => createSwarmUpdater(harness([], [])).stop()).not.toThrow();
  });
});
