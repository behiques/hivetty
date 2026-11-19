// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SwarmEntry } from '@shared/swarm-contract';

import type { SwarmDeps } from '../../../core/swarms/install';
import type { GitDeps } from '../../../core/swarms/git';
import type { AuthedFetch, RegistryRead } from '../../../core/swarms/registry';

const engine = vi.hoisted(() => ({
  installed: vi.fn(),
  install: vi.fn(),
  remove: vi.fn(),
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
vi.mock('../../../core/config/paths', () => ({ configPath: () => '/h/config.json' }));
vi.mock('../../../core/seed', () => ({
  shippedOptions: () => ({ source: '/r', target: '/h', manifestFile: '/h/.seed.json' }),
}));
vi.mock('../../../core/platform', () => ({ platform: () => ({ lifecycle: { version: '1.0.0' } }) }));

const { resetSwarms, setSwarmHooks, swarmCalls, swarmManifestFiles, swarmSeedSetFor, swarmSeedSets } = await import(
  '../../../core/swarms'
);

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
  authedFetch: vi.fn(() => authedFetch),
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
