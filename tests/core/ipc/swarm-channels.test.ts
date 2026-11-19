// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The swarm channels (HIVE-441), registered the way the clone channels are.
 *
 * Mocked the way `tests/core/ipc-security.test.ts` mocks electron, and
 * for the same reason: `ipc/index.ts` imports it at module scope, so the mock
 * has to be installed before the dynamic import below. `ipcMain.handle` records
 * every registration, which is how a test reaches a handler that is otherwise
 * only callable by Electron.
 */
const handlers = new Map<
  string,
  (event: unknown, payload: unknown) => unknown
>();

const shutdownHooks: (() => void)[] = [];

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0',
    on: vi.fn(),
    // HIVE-81 review: `registerIpcHandlers` now wires app-level window focus
    // events, and `resetIpcHandlers` takes them off again.
    removeListener: vi.fn(),
    // Per-spec, never shared: these specs really write a container set here,
    // and vitest runs spec files in parallel worker processes (HIVE-139).
    getPath: () => '/tmp/hive-test-swarm-channels',
  },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn() },
  /**
   * HIVE-67. `ipc/index.ts` builds the Jira integration at registration time
   * and hands it `safeStorage`, so the mock has to answer for it. Encryption
   * reports as unavailable, which is the state that stores nothing — a test of
   * the config channels must not write a credential file.
   */
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  },
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, payload: unknown) => unknown,
    ) => {
      handlers.set(channel, fn);
    },
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
}));

/** The host is never started for real; nothing here spawns a process. */
vi.mock('../../../core/pty-host', () => ({
  registerPtyHost: () => ({
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onData: () => () => {},
    onExit: () => () => {},
    onSpawned: () => () => {},
    onError: () => () => {},
    onSessionLost: () => () => {},
    onForeground: () => () => {},
    shutdown: async () => {},
    isRunning: () => true,
    isBlocked: () => false,
    sessionIds: () => [],
  }),
}));

vi.mock('../../../core/shutdown', () => ({
  onShutdown: (hook: () => void) => shutdownHooks.push(hook),
}));

/** `core/swarms`, so the spec proves each channel reaches this machine's engine with its payload. */
const swarmSpies = vi.hoisted(() => ({
  list: vi.fn(() => Promise.resolve('LIST')),
  install: vi.fn((_payload: unknown) => Promise.resolve('INSTALL')),
  remove: vi.fn((_payload: unknown) => Promise.resolve('REMOVE')),
  setAutoUpdate: vi.fn((_payload: unknown) => Promise.resolve('SET_AUTO_UPDATE')),
  check: vi.fn(() => Promise.resolve('CHECK')),
}));
const setSwarmHooks = vi.hoisted(() => vi.fn());
const stopSwarmTimer = vi.hoisted(() => vi.fn());
const startSwarmUpdates = vi.hoisted(() => vi.fn(() => stopSwarmTimer));
const swarmRunsIdle = vi.hoisted(() => vi.fn());
const swarmSessionChanged = vi.hoisted(() => vi.fn());
const takeSwarmInstallRequest = vi.hoisted(() => vi.fn<() => string | null>(() => 'a1'));

/** Two seed sets: the shipped one, `S`, and one installed swarm's, `W`, which owns `skills/tdd`. */
const sets = vi.hoisted(() => {
  const S = { source: '/r', target: '/h', manifestFile: '/h/.seed.json', exclude: new Set(['skills/tdd']) };
  const W = { source: '/h/swarms/a1/repo/standard', target: '/h', manifestFile: '/h/swarms/a1/seed.json' };
  return { S, W };
});
const swarmSeedSets = vi.hoisted(() => vi.fn());
const swarmSeedSetFor = vi.hoisted(() => vi.fn());
vi.mock('../../../core/swarms', () => ({
  swarmCalls: () => swarmSpies,
  setSwarmHooks,
  swarmSeedSets,
  swarmSeedSetFor,
  startSwarmUpdates,
  swarmRunsIdle,
  swarmSessionChanged,
  takeSwarmInstallRequest,
}));

/** `core/seed`'s actions, so the spec proves which set each one was handed. */
const seed = vi.hoisted(() => ({
  seedShippedIntoHive: vi.fn((_source?: string, _exclude?: ReadonlySet<string>) => Promise.resolve(null)),
  shippedStatus: vi.fn((options: { manifestFile: string }) =>
    Promise.resolve(options.manifestFile === '/h/.seed.json' ? [{ name: 'from-S' }] : [{ name: 'from-W' }]),
  ),
  resetShipped: vi.fn((_options: unknown, _request: unknown) => Promise.resolve([])),
  takeShippedPrompt: vi.fn((_options: unknown, _request: unknown) => Promise.resolve([])),
  keepMine: vi.fn((_options: unknown, _request: unknown) => Promise.resolve([])),
}));
vi.mock('../../../core/seed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../core/seed')>()),
  ...seed,
}));

const ownerOf = (kind: string, name: string) =>
  Promise.resolve(kind === 'skills' && name === 'tdd' ? sets.W : sets.S);

const { CH } = await import('../../../shared/ipc-contract');
const { installDesktopPlatform } = await import('../../support/desktop-platform');
const { registerIpcHandlers, resetIpcHandlers } = await import('../../../core/ipc');

const mainFrame = { url: 'file:///out/renderer/index.html' };
const trustedEvent = { senderFrame: mainFrame, sender: { mainFrame } } as never;

const invoke = (channel: string, payload: unknown) =>
  Promise.resolve().then(() => handlers.get(channel)!(trustedEvent, payload));

beforeEach(() => {
  vi.clearAllMocks();
  swarmSeedSets.mockResolvedValue({ shipped: sets.S, swarms: [sets.W] });
  swarmSeedSetFor.mockImplementation(ownerOf);
  installDesktopPlatform();
  handlers.clear();
  shutdownHooks.length = 0;
  registerIpcHandlers();
});

afterEach(() => {
  resetIpcHandlers();
});

describe('the swarm channels', () => {
  it('registers all three', () => {
    for (const channel of [CH.swarmsList, CH.swarmsInstall, CH.swarmsRemove]) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it('swarms:list reaches the engine', async () => {
    await expect(invoke(CH.swarmsList, undefined)).resolves.toBe('LIST');
    expect(swarmSpies.list).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['swarms:install', 'install', 'INSTALL'],
    ['swarms:remove', 'remove', 'REMOVE'],
  ] as const)('%s hands its payload to the engine untouched', async (channel, verb, answer) => {
    await expect(invoke(channel, { swarmId: 'a1' })).resolves.toBe(answer);
    expect(swarmSpies[verb]).toHaveBeenCalledWith({ swarmId: 'a1' });
  });

  it('feeds the engine its nine hooks once', () => {
    expect(setSwarmHooks).toHaveBeenCalledTimes(1);
    const hooks = setSwarmHooks.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([
      'afterAgents',
      'afterSkills',
      'authedFetch',
      'changed',
      'env',
      'installRequested',
      'notify',
      'ready',
      'runsLive',
    ]);
    for (const member of Object.values(hooks)) expect(typeof member).toBe('function');
  });
});

describe('the swarm update channels (HIVE-442)', () => {
  interface Hooks {
    runsLive: () => boolean;
    changed: (event: unknown) => void;
    notify: (updated: { swarmId: string; title: string; version: string }) => void;
  }
  const hooksGiven = (): Hooks => setSwarmHooks.mock.calls.at(-1)?.[0] as Hooks;

  it('swarms:set-auto-update hands its payload to the engine untouched', async () => {
    await expect(invoke(CH.swarmsSetAutoUpdate, { swarmId: 'a1', autoUpdate: false })).resolves.toBe('SET_AUTO_UPDATE');
    expect(swarmSpies.setAutoUpdate).toHaveBeenCalledWith({ swarmId: 'a1', autoUpdate: false });
  });

  it('swarms:check reaches the engine', async () => {
    await expect(invoke(CH.swarmsCheck, undefined)).resolves.toBe('CHECK');
    expect(swarmSpies.check).toHaveBeenCalledTimes(1);
  });

  it('starts the six-hour check and looks at the session once, at registration', () => {
    expect(startSwarmUpdates).toHaveBeenCalledTimes(1);
    expect(swarmSessionChanged).toHaveBeenCalledTimes(1);
  });

  it('stops the timer on teardown, and starts one timer per registration', () => {
    resetIpcHandlers();
    expect(stopSwarmTimer).toHaveBeenCalledTimes(1);

    registerIpcHandlers();
    expect(startSwarmUpdates).toHaveBeenCalledTimes(2);
  });

  it('counts no live run before any run starts', () => {
    expect(hooksGiven().runsLive()).toBe(false);
  });

  it('pushes swarms:changed through the broadcaster', () => {
    resetIpcHandlers();
    const emit = vi.fn();
    registerIpcHandlers({ emit });

    hooksGiven().changed({ updated: null });

    expect(emit).toHaveBeenCalledWith(CH.swarmsChanged, { updated: null });
  });

  it('raises one swarm.updated notification for an automatic update', async () => {
    hooksGiven().notify({ swarmId: 'a1', title: 'Standard', version: '1.4.0' });
    hooksGiven().notify({ swarmId: 'a1', title: 'Standard', version: '1.4.0' });

    const listed = (await invoke(CH.notificationsList, undefined)) as { kind: string; title: string }[];
    const swarm = listed.filter((row) => row.kind === 'swarm.updated');
    expect(swarm).toHaveLength(1);
    expect(swarm[0]?.title).toBe('Standard updated to v1.4.0');
  });
});

describe('the install link channels (HIVE-442)', () => {
  it('swarms:take-install-request answers what core holds', async () => {
    await expect(invoke(CH.swarmsTakeInstallRequest, undefined)).resolves.toBe('a1');
    expect(takeSwarmInstallRequest).toHaveBeenCalledTimes(1);
  });

  it('pushes swarms:install-requested with no payload', () => {
    resetIpcHandlers();
    const emit = vi.fn();
    registerIpcHandlers({ emit });

    (setSwarmHooks.mock.calls.at(-1)?.[0] as { installRequested: () => void }).installRequested();

    expect(emit).toHaveBeenCalledWith(CH.swarmsInstallRequested, undefined);
  });
});

describe('the shipped handlers over every seed set (HIVE-441)', () => {
  const both = [{ name: 'from-S' }, { name: 'from-W' }];

  it("shipped:status answers the shipped set's statuses, then each swarm's", async () => {
    await expect(invoke(CH.shippedStatus, undefined)).resolves.toEqual(both);
    expect(seed.shippedStatus).toHaveBeenCalledWith(sets.S);
    expect(seed.shippedStatus).toHaveBeenCalledWith(sets.W);
  });

  it.each([
    [CH.shippedReset, 'resetShipped'],
    [CH.shippedTakePrompt, 'takeShippedPrompt'],
    [CH.shippedKeepMine, 'keepMine'],
  ] as const)('%s acts on the set that owns the skill, then answers every set', async (channel, act) => {
    const swarmOwned = { kind: 'skills', name: 'tdd' };
    await expect(invoke(channel, swarmOwned)).resolves.toEqual(both);
    expect(seed[act]).toHaveBeenLastCalledWith(sets.W, swarmOwned);

    const shippedOwned = { kind: 'skills', name: 'other' };
    await expect(invoke(channel, shippedOwned)).resolves.toEqual(both);
    expect(seed[act]).toHaveBeenLastCalledWith(sets.S, shippedOwned);
  });

  it('refuses a malformed request before it acts', async () => {
    await expect(invoke(CH.shippedReset, { kind: 'nope', name: 'tdd' })).rejects.toThrow();
    expect(seed.resetShipped).not.toHaveBeenCalled();
  });
});

describe('the boot seed (HIVE-441)', () => {
  it('passes over every folder an installed swarm owns', async () => {
    await vi.waitFor(() => expect(seed.seedShippedIntoHive).toHaveBeenCalledTimes(1));
    expect(seed.seedShippedIntoHive).toHaveBeenCalledWith(undefined, sets.S.exclude);
  });

  it('still seeds, passing over nothing, when the seed sets cannot be read', async () => {
    resetIpcHandlers();
    vi.clearAllMocks();
    swarmSeedSets.mockRejectedValue(new Error('installed.json unreadable'));
    registerIpcHandlers();

    await vi.waitFor(() => expect(seed.seedShippedIntoHive).toHaveBeenCalledTimes(1));
    expect(seed.seedShippedIntoHive).toHaveBeenCalledWith(undefined, undefined);
  });
});
