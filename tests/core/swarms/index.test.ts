// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstalledSwarm, SwarmEntry } from '@shared/swarm-contract';

import type { SwarmDeps } from '../../../core/swarms/install';
import type { GitDeps } from '../../../core/swarms/git';
import type { AuthedFetch, RegistryRead } from '../../../core/swarms/registry';

const engine = vi.hoisted(() => ({
  installed: vi.fn(),
  install: vi.fn(),
  remove: vi.fn(),
  setAutoUpdate: vi.fn(),
  seedSets: vi.fn(),
  seedSetFor: vi.fn(),
  manifestFiles: vi.fn(),
}));
const createSwarms = vi.hoisted(() => vi.fn((_deps: unknown) => engine));
const registry = vi.hoisted(() => ({ readRegistry: vi.fn(), cloneToken: vi.fn() }));
const createSwarmGit = vi.hoisted(() => vi.fn((_deps: unknown) => ({ fetch: vi.fn(), newestVersion: vi.fn() })));

vi.mock('../../../core/swarms/install', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../core/swarms/install')>()),
  createSwarms,
}));
vi.mock('../../../core/swarms/registry', () => registry);
vi.mock('../../../core/swarms/git', () => ({ createSwarmGit }));
const reportInstall = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve()));
vi.mock('../../../core/swarms/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../core/swarms/report')>()),
  reportInstall,
}));
vi.mock('../../../core/config/paths', () => ({ configPath: () => '/h/config.json' }));
vi.mock('../../../core/seed', () => ({
  shippedOptions: () => ({ source: '/r', target: '/h', manifestFile: '/h/.seed.json' }),
}));
vi.mock('../../../core/platform', () => ({ platform: () => ({ lifecycle: { version: '1.0.0' } }) }));

const {
  resetSwarms,
  setSwarmHooks,
  startSwarmUpdates,
  swarmCalls,
  swarmManifestFiles,
  swarmRunsIdle,
  swarmSeedSetFor,
  swarmSeedSets,
  swarmSessionChanged,
} = await import('../../../core/swarms');

const entry = (id: string, patch: Partial<SwarmEntry> = {}): SwarmEntry => ({
  id,
  slug: 'standard',
  kind: 'native',
  title: 'Standard',
  description: 'Ticket to merge.',
  publisher: 'HiveTTY',
  tags: [],
  version: '1.0.0',
  updatedAt: '2026-11-19T00:00:00.000Z',
  installs: 0,
  agents: [],
  skills: [],
  repoUrl: 'https://github.com/behiques/hivetty-swarms.git',
  folder: 'standard',
  commit: 'a'.repeat(40),
  access: 'token',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
  ...patch,
});

const a1 = entry('a1');
const read: RegistryRead = { swarms: [a1], source: 'cloud' };
const authedFetch: AuthedFetch = vi.fn();

const hooks = () => ({
  ready: vi.fn(() => Promise.resolve()),
  afterSkills: vi.fn(),
  afterAgents: vi.fn(),
  env: vi.fn(() => ({})),
  authedFetch: vi.fn<() => AuthedFetch | null>(() => authedFetch),
  runsLive: vi.fn(() => false),
  changed: vi.fn(),
  notify: vi.fn(),
});

let h: ReturnType<typeof hooks>;

beforeEach(() => {
  vi.clearAllMocks();
  registry.readRegistry.mockResolvedValue(read);
  engine.installed.mockResolvedValue([]);
  h = hooks();
  setSwarmHooks(h);
});

afterEach(() => {
  resetSwarms();
});

describe('swarmCalls().install', () => {
  it('installs the registry row and runs both hooks once', async () => {
    const result = { ok: true, installed: { id: 'a1' } };
    engine.install.mockResolvedValue(result);

    await expect(swarmCalls().install({ swarmId: 'a1' })).resolves.toBe(result);

    expect(engine.install).toHaveBeenCalledWith(a1);
    expect(h.afterSkills).toHaveBeenCalledTimes(1);
    expect(h.afterAgents).toHaveBeenCalledTimes(1);
  });

  it('answers unavailable for an id the registry does not hold, and installs nothing', async () => {
    await expect(swarmCalls().install({ swarmId: 'zz' })).resolves.toEqual({
      ok: false,
      failure: { code: 'unavailable', message: "This swarm isn't available to your account." },
    });
    expect(engine.install).not.toHaveBeenCalled();
  });

  it("installs the registry's repository, never one the caller names", async () => {
    engine.install.mockResolvedValue({ ok: true, installed: { id: 'a1' } });

    await swarmCalls().install({ swarmId: 'a1', repoUrl: 'https://evil/x' });

    expect(engine.install).toHaveBeenCalledWith(a1);
    expect((engine.install.mock.calls[0]?.[0] as SwarmEntry).repoUrl).toBe(a1.repoUrl);
  });

  it.each([[{ swarmId: '../x' }], [null]])('rejects the payload %j', async (payload) => {
    await expect(swarmCalls().install(payload)).rejects.toThrow();
    expect(engine.install).not.toHaveBeenCalled();
  });

  it('runs both hooks after a failed install too', async () => {
    engine.install.mockResolvedValue({ ok: false, failure: { code: 'failed', message: 'no' } });

    await swarmCalls().install({ swarmId: 'a1' });

    expect(h.afterSkills).toHaveBeenCalledTimes(1);
    expect(h.afterAgents).toHaveBeenCalledTimes(1);
  });
});

describe('swarmCalls().remove', () => {
  it('removes by id and runs both hooks', async () => {
    engine.remove.mockResolvedValue({ ok: true });

    await expect(swarmCalls().remove({ swarmId: 'a1' })).resolves.toEqual({ ok: true });

    expect(engine.remove).toHaveBeenCalledWith('a1');
    expect(h.afterSkills).toHaveBeenCalledTimes(1);
    expect(h.afterAgents).toHaveBeenCalledTimes(1);
  });

  it('runs both hooks after a failed remove too', async () => {
    engine.remove.mockResolvedValue({ ok: false, failure: { code: 'failed', message: 'no' } });

    await swarmCalls().remove({ swarmId: 'a1' });

    expect(h.afterSkills).toHaveBeenCalledTimes(1);
    expect(h.afterAgents).toHaveBeenCalledTimes(1);
  });

  it('rejects a payload with no id', async () => {
    await expect(swarmCalls().remove({})).rejects.toThrow();
    expect(engine.remove).not.toHaveBeenCalled();
  });
});

describe('swarmCalls().list', () => {
  it('merges the registry with what is installed', async () => {
    const { mergeListing } = await vi.importActual<typeof import('../../../core/swarms/install')>(
      '../../../core/swarms/install',
    );
    const installed = [
      { id: 'a1', slug: 'standard', version: '0.9.0', folder: 'standard', commit: 'b'.repeat(40) },
    ];
    engine.installed.mockResolvedValue(installed);

    await expect(swarmCalls().list()).resolves.toEqual(mergeListing(read, installed as never));
  });
});

describe('the registry read', () => {
  it("reads through the hook's fetch and the cache under ~/.hivetty/swarms", async () => {
    await swarmCalls().list();

    expect(registry.readRegistry).toHaveBeenCalledWith(authedFetch, '/h/swarms/registry.json');
  });

  it('reads with no fetch before the hooks are set', async () => {
    resetSwarms();

    await swarmCalls().list();

    expect(registry.readRegistry).toHaveBeenCalledWith(null, '/h/swarms/registry.json');
  });
});

describe('the engine', () => {
  it('is made once, over ~/.hivetty, with the shipped manifest and the app version', async () => {
    await swarmCalls().list();
    await swarmCalls().list();

    expect(createSwarms).toHaveBeenCalledTimes(1);
    expect(createSwarms).toHaveBeenCalledWith(
      expect.objectContaining({ hiveDir: '/h', shippedManifest: '/h/.seed.json', appVersion: '1.0.0' }),
    );
  });

  it("asks the registry for a clone token with the hook's fetch, and waits for the hook's ready", async () => {
    await swarmCalls().list();
    const deps = createSwarms.mock.calls[0]?.[0] as SwarmDeps;
    registry.cloneToken.mockResolvedValue({ token: 't', repoUrl: a1.repoUrl });

    await expect(deps.cloneToken('a1')).resolves.toEqual({ token: 't', repoUrl: a1.repoUrl });
    expect(registry.cloneToken).toHaveBeenCalledWith(authedFetch, 'a1');

    await deps.ready?.();
    expect(h.ready).toHaveBeenCalledTimes(1);
  });

  it('reads the hooks at call time, so hooks set after the engine was made are the ones used', async () => {
    await swarmCalls().list();
    const deps = createSwarms.mock.calls[0]?.[0] as SwarmDeps;
    const later = hooks();
    setSwarmHooks(later);

    await deps.ready?.();
    await deps.cloneToken('a1');

    expect(later.ready).toHaveBeenCalledTimes(1);
    expect(later.authedFetch).toHaveBeenCalled();
    expect(h.ready).not.toHaveBeenCalled();
  });

  it("runs Git in the later hooks' environment, with the askpass under ~/.hivetty/swarms", async () => {
    await swarmCalls().list();
    const deps = createSwarmGit.mock.calls[0]?.[0] as GitDeps;
    const later = hooks();
    later.env.mockReturnValue({ LATER: '1' });
    setSwarmHooks(later);

    expect(deps.env()).toEqual({ LATER: '1' });
    expect(deps.askpass).toMatch(/^\/h\/swarms\//);
  });
});

describe('before the hooks are set', () => {
  it("runs the defaults: no session, the process's environment, nothing to wait for or refresh", async () => {
    resetSwarms();
    engine.install.mockResolvedValue({ ok: true, installed: { id: 'a1' } });

    await expect(swarmCalls().install({ swarmId: 'a1' })).resolves.toEqual({ ok: true, installed: { id: 'a1' } });
    const deps = createSwarms.mock.calls[0]?.[0] as SwarmDeps;
    await expect(deps.ready?.()).resolves.toBeUndefined();
    expect((createSwarmGit.mock.calls[0]?.[0] as GitDeps).env()).toBe(process.env);
    await deps.cloneToken('a1');
    expect(registry.cloneToken).toHaveBeenCalledWith(null, 'a1');
  });
});

describe('the seed sets', () => {
  const shipped = { source: '/r', target: '/h', manifestFile: '/h/.seed.json' };

  it('asks the engine with the shipped options', async () => {
    const sets = { shipped, swarms: [] };
    engine.seedSets.mockResolvedValue(sets);

    await expect(swarmSeedSets()).resolves.toBe(sets);
    expect(engine.seedSets).toHaveBeenCalledWith(shipped);
  });

  it('asks the engine for every swarm manifest on disk', async () => {
    engine.manifestFiles.mockResolvedValue(['/h/swarms/a1/seed.json', '/h/swarms/a1/pending.json']);

    await expect(swarmManifestFiles()).resolves.toEqual(['/h/swarms/a1/seed.json', '/h/swarms/a1/pending.json']);
  });

  it('asks for the set that owns one skill by its folder', async () => {
    engine.seedSetFor.mockResolvedValue(shipped);

    await expect(swarmSeedSetFor('skills', 'tdd')).resolves.toBe(shipped);
    expect(engine.seedSetFor).toHaveBeenCalledWith(shipped, 'skills/tdd');
  });
});

const heldAt = (swarmId: string, version: string, patch: Partial<InstalledSwarm> = {}): InstalledSwarm => ({
  swarmId,
  slug: 'standard',
  kind: 'native',
  org: null,
  repoUrl: a1.repoUrl,
  folder: 'standard',
  version,
  commit: 'b'.repeat(40),
  installedAt: '2026-11-19T12:00:00.000Z',
  autoUpdate: true,
  lastError: null,
  title: 'Standard',
  description: 'Ticket to merge.',
  contents: { agents: [], skills: [] },
  ...patch,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

describe('the one install path (HIVE-442)', () => {
  it('reports a first install, says the list changed with nothing updated, and refreshes', async () => {
    engine.install.mockResolvedValue({ ok: true, installed: heldAt('a1', '1.0.0') });

    await swarmCalls().install({ swarmId: 'a1' });

    expect(reportInstall).toHaveBeenCalledWith(authedFetch, 'a1', { state: 'installed', version: '1.0.0' });
    expect(h.changed).toHaveBeenCalledWith({ updated: null });
    expect(h.afterSkills).toHaveBeenCalledTimes(1);
    expect(h.afterAgents).toHaveBeenCalledTimes(1);
  });

  it('names the update when the install replaced an older version', async () => {
    engine.installed.mockResolvedValue([heldAt('a1', '0.9.0')]);
    engine.install.mockResolvedValue({ ok: true, installed: heldAt('a1', '1.0.0') });

    await swarmCalls().install({ swarmId: 'a1' });

    expect(h.changed).toHaveBeenCalledWith({ updated: { swarmId: 'a1', title: 'Standard', version: '1.0.0' } });
  });

  it('names no update for a reinstall at the same version', async () => {
    engine.installed.mockResolvedValue([heldAt('a1', '1.0.0')]);
    engine.install.mockResolvedValue({ ok: true, installed: heldAt('a1', '1.0.0') });

    await swarmCalls().install({ swarmId: 'a1' });

    expect(h.changed).toHaveBeenCalledWith({ updated: null });
  });

  it('reports no_access, and nothing for any other failure', async () => {
    engine.install.mockResolvedValueOnce({ ok: false, failure: { code: 'no_access', message: 'no' } });
    await swarmCalls().install({ swarmId: 'a1' });
    expect(reportInstall).toHaveBeenCalledWith(authedFetch, 'a1', { state: 'no_access' });
    expect(h.changed).toHaveBeenCalledWith({ updated: null });

    reportInstall.mockClear();
    engine.install.mockResolvedValueOnce({ ok: false, failure: { code: 'failed', message: 'no' } });
    await swarmCalls().install({ swarmId: 'a1' });
    expect(reportInstall).not.toHaveBeenCalled();
  });

  it('does not wait for the report', async () => {
    reportInstall.mockReturnValueOnce(new Promise<void>(() => undefined));
    engine.install.mockResolvedValue({ ok: true, installed: heldAt('a1', '1.0.0') });

    await expect(swarmCalls().install({ swarmId: 'a1' })).resolves.toMatchObject({ ok: true });
  });

  it('reports nothing for an id the registry does not hold', async () => {
    await swarmCalls().install({ swarmId: 'zz' });
    expect(reportInstall).not.toHaveBeenCalled();
  });
});

describe('a removal (HIVE-442)', () => {
  it('reports removed with the version that was installed, and says the list changed', async () => {
    engine.installed.mockResolvedValue([heldAt('a1', '1.0.0')]);
    engine.remove.mockResolvedValue({ ok: true });

    await swarmCalls().remove({ swarmId: 'a1' });

    expect(reportInstall).toHaveBeenCalledWith(authedFetch, 'a1', { state: 'removed', version: '1.0.0' });
    expect(h.changed).toHaveBeenCalledWith({ updated: null });
  });

  it('reports nothing when the removal failed', async () => {
    engine.installed.mockResolvedValue([heldAt('a1', '1.0.0')]);
    engine.remove.mockResolvedValue({ ok: false, failure: { code: 'failed', message: 'no' } });

    await swarmCalls().remove({ swarmId: 'a1' });

    expect(reportInstall).not.toHaveBeenCalled();
  });

  it('reports nothing for a swarm that was not installed', async () => {
    engine.remove.mockResolvedValue({ ok: true });

    await swarmCalls().remove({ swarmId: 'a1' });

    expect(reportInstall).not.toHaveBeenCalled();
  });

  it('clears the pending update of the removed swarm', async () => {
    registry.readRegistry.mockResolvedValue({ source: 'cloud', swarms: [entry('a1', { kind: 'community', access: 'anonymous' })] });
    engine.installed.mockResolvedValue([heldAt('a1', '0.9.0', { kind: 'community' })]);
    await swarmCalls().check();
    engine.remove.mockResolvedValue({ ok: true });

    await swarmCalls().remove({ swarmId: 'a1' });
    engine.installed.mockResolvedValue([]);

    expect((await swarmCalls().list()).items[0]?.update).toBeNull();
  });
});

describe('swarmCalls().setAutoUpdate', () => {
  it('writes the flag, answers the entry, and starts a check', async () => {
    const written = heldAt('a1', '1.0.0', { autoUpdate: false });
    engine.setAutoUpdate.mockResolvedValue(written);

    await expect(swarmCalls().setAutoUpdate({ swarmId: 'a1', autoUpdate: false })).resolves.toBe(written);
    expect(engine.setAutoUpdate).toHaveBeenCalledWith('a1', false);
    await flush();
    expect(registry.readRegistry).toHaveBeenCalled();
  });

  it('rejects a payload with no flag, and writes nothing', async () => {
    await expect(swarmCalls().setAutoUpdate({ swarmId: 'a1' })).rejects.toThrow();
    expect(engine.setAutoUpdate).not.toHaveBeenCalled();
  });
});

describe('swarmCalls().check', () => {
  it('checks, then answers the list', async () => {
    const listing = await swarmCalls().check();

    expect(registry.readRegistry).toHaveBeenCalled();
    expect(listing).toEqual(await swarmCalls().list());
  });

  it('puts a pending update on the list until an install settles it', async () => {
    registry.readRegistry.mockResolvedValue({ source: 'cloud', swarms: [entry('a1', { kind: 'community', access: 'anonymous' })] });
    engine.installed.mockResolvedValue([heldAt('a1', '0.9.0', { kind: 'community' })]);

    const listing = await swarmCalls().check();
    expect(listing.items[0]?.update).toEqual({ target: '1.0.0', updating: false });

    engine.install.mockResolvedValue({ ok: true, installed: heldAt('a1', '1.0.0', { kind: 'community' }) });
    await swarmCalls().install({ swarmId: 'a1' });
    expect((await swarmCalls().list()).items[0]?.update).toBeNull();
  });

  it("applies an automatic update through the same install path, and notifies", async () => {
    engine.installed.mockResolvedValue([heldAt('a1', '0.9.0')]);
    engine.install.mockResolvedValue({ ok: true, installed: heldAt('a1', '1.0.0') });

    await swarmCalls().check();

    expect(engine.install).toHaveBeenCalledWith(a1);
    expect(reportInstall).toHaveBeenCalledTimes(1);
    expect(h.changed).toHaveBeenCalledWith({ updated: { swarmId: 'a1', title: 'Standard', version: '1.0.0' } });
    expect(h.notify).toHaveBeenCalledWith({ swarmId: 'a1', title: 'Standard', version: '1.0.0' });
  });

  it("asks Git for an organization swarm's newest version", async () => {
    registry.readRegistry.mockResolvedValue({
      source: 'cloud',
      swarms: [entry('a1', { kind: 'organization', version: null, commit: null, org: { id: 'o', name: 'Acme' } })],
    });
    engine.installed.mockResolvedValue([heldAt('a1', '0.9.0', { kind: 'organization', autoUpdate: false })]);
    await swarmCalls().list();
    const git = createSwarmGit.mock.results[0]?.value as { newestVersion: ReturnType<typeof vi.fn> };
    git.newestVersion.mockResolvedValue('1.1.0');

    const listing = await swarmCalls().check();

    expect(git.newestVersion).toHaveBeenCalledWith(a1.repoUrl, 'standard');
    expect(listing.items[0]?.update).toEqual({ target: '1.1.0', updating: false });
  });
});

describe('swarmSessionChanged', () => {
  it('checks once each time a cloud session appears', async () => {
    h.authedFetch.mockReturnValue(null);
    swarmSessionChanged();
    await flush();
    expect(registry.readRegistry).not.toHaveBeenCalled();

    h.authedFetch.mockReturnValue(authedFetch);
    swarmSessionChanged();
    await flush();
    expect(registry.readRegistry).toHaveBeenCalledTimes(1);

    swarmSessionChanged();
    await flush();
    expect(registry.readRegistry).toHaveBeenCalledTimes(1);

    h.authedFetch.mockReturnValue(null);
    swarmSessionChanged();
    h.authedFetch.mockReturnValue(authedFetch);
    swarmSessionChanged();
    await flush();
    expect(registry.readRegistry).toHaveBeenCalledTimes(2);
  });
});

describe('startSwarmUpdates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks every six hours until the answer stops it', async () => {
    vi.useFakeTimers();
    const stop = startSwarmUpdates();

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(registry.readRegistry).toHaveBeenCalledTimes(1);

    stop();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(registry.readRegistry).toHaveBeenCalledTimes(1);
  });
});

describe('swarmRunsIdle', () => {
  it('applies a pending automatic update once the runs end', async () => {
    h.runsLive.mockReturnValue(true);
    engine.installed.mockResolvedValue([heldAt('a1', '0.9.0')]);
    await swarmCalls().check();
    expect(engine.install).not.toHaveBeenCalled();
    engine.install.mockResolvedValue({ ok: true, installed: heldAt('a1', '1.0.0') });

    h.runsLive.mockReturnValue(false);
    swarmRunsIdle();
    await flush();

    expect(engine.install).toHaveBeenCalledWith(a1);
  });
});

describe('resetSwarms (HIVE-442)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops the timer and forgets the session', async () => {
    vi.useFakeTimers();
    startSwarmUpdates();
    swarmSessionChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.readRegistry).toHaveBeenCalledTimes(1);

    resetSwarms();
    setSwarmHooks(h);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(registry.readRegistry).toHaveBeenCalledTimes(1);

    swarmSessionChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.readRegistry).toHaveBeenCalledTimes(2);
  });
});
