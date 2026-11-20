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
  setEnabled: vi.fn((_payload: unknown) => Promise.resolve('SET_ENABLED')),
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
  const W = { source: '/h/swarms/a1/repo/dev-squad', target: '/h', manifestFile: '/h/swarms/a1/seed.json' };
  const K = { source: '/h/swarms/k1/repo', target: '/h', manifestFile: '/h/swarms/k1/seed.json' };
  return { W, K };
});
const swarmSeedSets = vi.hoisted(() => vi.fn());
/** HIVE-447: boot's promise, adoption alone since HIVE-448. The test holds it open to prove what waits for it. */
const boot = vi.hoisted(() => ({ release: (): void => undefined }));
const adopt = vi.hoisted(() =>
  vi.fn(
    () =>
      new Promise<void>((resolve) => {
        boot.release = resolve;
      }),
  ),
);
const swarmSeedSetFor = vi.hoisted(() => vi.fn());
vi.mock('../../../core/swarms', () => ({
  swarmCalls: () => swarmSpies,
  setSwarmHooks,
  swarmSeedSets,
  swarmSeedSetFor,
  adopt,
  startSwarmUpdates,
  swarmRunsIdle,
  swarmSessionChanged,
  takeSwarmInstallRequest,
}));

/** `core/seed`'s actions, so the spec proves which set each one was handed. */
const seed = vi.hoisted(() => ({
  shippedStatus: vi.fn((options: { manifestFile: string }) =>
    Promise.resolve(options.manifestFile === '/h/swarms/a1/seed.json' ? [{ name: 'from-W' }] : [{ name: 'from-K' }]),
  ),
  resetShipped: vi.fn((_options: unknown, _request: unknown) => Promise.resolve([])),
  takeShippedPrompt: vi.fn((_options: unknown, _request: unknown) => Promise.resolve([])),
  keepMine: vi.fn((_options: unknown, _request: unknown) => Promise.resolve([])),
}));
vi.mock('../../../core/seed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../core/seed')>()),
  ...seed,
}));

/** `tdd` is the swarm's; no swarm owns anything else (HIVE-448: there is no shipped set to fall back to). */
const ownerOf = (kind: string, name: string) => Promise.resolve(kind === 'skills' && name === 'tdd' ? sets.W : null);

const { CH } = await import('../../../shared/ipc-contract');
const { installDesktopPlatform } = await import('../../support/desktop-platform');
const { registerIpcHandlers, resetIpcHandlers } = await import('../../../core/ipc');

const mainFrame = { url: 'file:///out/renderer/index.html' };
const trustedEvent = { senderFrame: mainFrame, sender: { mainFrame } } as never;

const invoke = (channel: string, payload: unknown) =>
  Promise.resolve().then(() => handlers.get(channel)!(trustedEvent, payload));

beforeEach(() => {
  vi.clearAllMocks();
  swarmSeedSets.mockResolvedValue([sets.W, sets.K]);
  swarmSeedSetFor.mockImplementation(ownerOf);
  installDesktopPlatform();
  handlers.clear();
  shutdownHooks.length = 0;
  registerIpcHandlers();
  boot.release(); // most cases want a finished boot; the boot cases hold their own
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

  it('swarms:set-enabled hands its payload to the engine untouched (HIVE-453)', async () => {
    const payload = { swarmId: 'a1', kind: 'skills', name: 'tdd', enabled: false, extra: 'passed through: the engine parses' };
    await expect(invoke(CH.swarmsSetEnabled, payload)).resolves.toBe('SET_ENABLED');
    expect(swarmSpies.setEnabled).toHaveBeenCalledWith(payload);
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

describe('the shipped handlers over every installed swarm (HIVE-441, HIVE-448)', () => {
  const both = [{ name: 'from-W' }, { name: 'from-K' }];

  it("shipped:status answers every installed swarm's statuses", async () => {
    await expect(invoke(CH.shippedStatus, undefined)).resolves.toEqual(both);
    expect(seed.shippedStatus).toHaveBeenCalledWith(sets.W);
    expect(seed.shippedStatus).toHaveBeenCalledWith(sets.K);
    expect(seed.shippedStatus).toHaveBeenCalledTimes(2);
  });

  it('shipped:status answers an empty list when no swarm is installed', async () => {
    swarmSeedSets.mockResolvedValue([]);

    await expect(invoke(CH.shippedStatus, undefined)).resolves.toEqual([]);
    expect(seed.shippedStatus).not.toHaveBeenCalled();
  });

  it.each([
    [CH.shippedReset, 'resetShipped'],
    [CH.shippedTakePrompt, 'takeShippedPrompt'],
    [CH.shippedKeepMine, 'keepMine'],
  ] as const)('%s acts on the swarm that owns the skill, then answers every swarm', async (channel, act) => {
    const swarmOwned = { kind: 'skills', name: 'tdd' };
    await expect(invoke(channel, swarmOwned)).resolves.toEqual(both);
    expect(seed[act]).toHaveBeenLastCalledWith(sets.W, swarmOwned);
  });

  it.each([
    [CH.shippedReset, 'resetShipped'],
    [CH.shippedTakePrompt, 'takeShippedPrompt'],
    [CH.shippedKeepMine, 'keepMine'],
  ] as const)('%s on a name no swarm owns acts on nothing and answers the statuses', async (channel, act) => {
    await expect(invoke(channel, { kind: 'skills', name: 'mine' })).resolves.toEqual(both);
    expect(seed[act]).not.toHaveBeenCalled();
  });

  it('rejects when the act throws, as before', async () => {
    seed.resetShipped.mockRejectedValueOnce(new Error('EACCES'));

    await expect(invoke(CH.shippedReset, { kind: 'skills', name: 'tdd' })).rejects.toThrow('EACCES');
  });

  it('refuses a malformed request before it acts', async () => {
    await expect(invoke(CH.shippedReset, { kind: 'nope', name: 'tdd' })).rejects.toThrow();
    expect(seed.resetShipped).not.toHaveBeenCalled();
  });
});

describe('boot (HIVE-441, HIVE-447, HIVE-448)', () => {
  /** Lets every pending step run, on fake time: AGENTS.md allows no real waits. */
  const settle = async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(20);
    } finally {
      vi.useRealTimers();
    }
  };

  const restart = (): void => {
    resetIpcHandlers();
    vi.clearAllMocks();
    swarmSeedSets.mockResolvedValue([sets.W, sets.K]);
    registerIpcHandlers();
  };

  it('runs adoption once and seeds nothing', () => {
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt).toHaveBeenCalledWith();
  });

  it('holds every swarm install until the adoption has finished', async () => {
    restart();
    const hooksGiven = setSwarmHooks.mock.calls.at(-1)?.[0] as { ready: () => Promise<unknown> };
    let ready = false;
    void hooksGiven.ready().then(() => {
      ready = true;
    });

    await settle();
    expect(ready).toBe(false);

    boot.release();
    await vi.waitFor(() => expect(ready).toBe(true));
  });

  it('holds the shipped actions until then too', async () => {
    restart();
    let answered = false;
    void invoke(CH.shippedStatus, undefined).then(() => {
      answered = true;
    });

    await settle();
    expect(answered).toBe(false);
    expect(seed.shippedStatus).not.toHaveBeenCalled();

    boot.release();
    await vi.waitFor(() => expect(answered).toBe(true));
  });
});
