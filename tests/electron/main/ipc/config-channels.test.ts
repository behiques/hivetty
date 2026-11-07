// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClis } from '../../../../electron/shared/cli-contract';
import { emptySnapshot } from '../../../../electron/shared/config-contract';

/**
 * Story 103's config channels.
 *
 * Mocked the way `clone-channels.test.ts` mocks electron, and for the same
 * reason: `ipc/index.ts` imports it at module scope, so the mock has to be
 * installed before the dynamic import below. `ipcMain.handle` records every
 * registration, which is how a test reaches a handler that is otherwise only
 * callable by Electron.
 *
 * The config module is mocked here — unlike in `clone-channels.test.ts` —
 * because what is under test is the *seam*: that the guard runs before the verb
 * and that whatever the verb returns is what the channel answers with. The
 * verbs' own behaviour is covered against a real filesystem in
 * `tests/electron/main/config/index.test.ts`.
 */
const handlers = new Map<
  string,
  (event: unknown, payload: unknown) => unknown
>();

const shutdownHooks: (() => void)[] = [];

/** HIVE-265: `app:info`'s `gateOff` reads `app.isPackaged`, so each test sets it. */
const electronApp = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronApp.isPackaged;
    },
    getVersion: () => '0.0.0',
    on: vi.fn(),
    // HIVE-81 review: `registerIpcHandlers` now wires app-level window focus
    // events, and `resetIpcHandlers` takes them off again.
    removeListener: vi.fn(),
    // Per-spec, never shared: these specs really write a container set here,
    // and vitest runs spec files in parallel worker processes (HIVE-139).
    getPath: () => '/tmp/hive-test-config-channels',
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

vi.mock('../../../../electron/main/pty-host', () => ({
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

vi.mock('../../../../electron/main/shutdown', () => ({
  onShutdown: (hook: () => void) => shutdownHooks.push(hook),
}));

/*
  The two runtimes Reload has to refresh, stubbed so the spec can see it
  refresh them and never reads a real `~/.hivetty`. Their own behaviour is
  covered in `tests/electron/main/skills` and `tests/electron/main/agents`.
*/
const skillsSync = vi.fn(() => Promise.resolve({} as never));
const agentsList = vi.fn(() => Promise.resolve({ agents: [], agentsRoot: '/tmp/.hive/agents' }));

vi.mock('../../../../electron/main/skills', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createSkillsRuntime: () => ({ sync: skillsSync, pluginDirPath: () => null, list: vi.fn() }),
}));

vi.mock('../../../../electron/main/agents', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createAgentsRuntime: () => ({
    list: agentsList,
    read: vi.fn(),
    write: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    onChange: () => () => {},
    close: vi.fn(),
  }),
}));

/**
 * The one object every mocked verb answers with, so identity is assertable.
 *
 * The whole snapshot, so no getter reading a field this fixture forgot can
 * throw into a swallowing catch (HIVE-139).
 */
const snapshot = emptySnapshot('/tmp/config.json', '/bin/zsh');

vi.mock('../../../../electron/main/config/index', () => ({
  getConfig: vi.fn(() => snapshot),
  bootConfig: vi.fn(() => snapshot),
  onConfigChange: vi.fn(() => () => {}),
  reloadConfig: vi.fn(() => snapshot),
  loadConfig: vi.fn(() => snapshot),
  addProject: vi.fn(() => snapshot),
  removeProject: vi.fn(() => snapshot),
  renameProject: vi.fn(() => snapshot),
  repointProject: vi.fn(() => snapshot),
  reorderProjects: vi.fn(() => snapshot),
  setCliSessions: vi.fn(() => snapshot),
  setCli: vi.fn(() => snapshot),
  configPath: vi.fn(() => '/tmp/config.json'),
}));

const detected = { 'claude-code': { path: '/bin/claude', version: '2.1.31' }, codex: { missing: 'no' }, copilot: { missing: 'no' } };
vi.mock('../../../../electron/main/harness/sign-in', () => ({
  readSignIn: vi.fn(async () => ({ state: 'in', label: 'GitHub: octo' })),
}));
vi.mock('../../../../electron/main/harness/detect', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  detectClis: vi.fn(async () => detected),
  rescanClis: vi.fn(async () => detected),
}));

vi.mock('../../../../electron/main/config/login-env', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loginEnvStatus: vi.fn(async () => ({ state: 'imported' })),
}));

vi.mock('../../../../electron/main/harness/codex/models', () => ({
  readCodexModels: () =>
    Promise.resolve([{ slug: 'gpt-6-luna', description: 'Fast.', defaultEffort: 'medium', efforts: ['low', 'medium'] }]),
}));

const { CH } = await import('../../../../electron/shared/ipc-contract');
const config = await import('../../../../electron/main/config/index');
const signIn = await import('../../../../electron/main/harness/sign-in');
const detect = await import('../../../../electron/main/harness/detect');
const { registerIpcHandlers, resetIpcHandlers } = await import(
  '../../../../electron/main/ipc'
);

/**
 * `assertSender` compares `senderFrame` to `sender.mainFrame` by **identity**,
 * so a trusted event has to share one object rather than two equal literals.
 */
const mainFrame = { url: 'file:///out/renderer/index.html' };
const trustedEvent = { senderFrame: mainFrame, sender: { mainFrame } } as never;
const untrustedEvent = {
  senderFrame: { url: 'https://evil.example/' },
  sender: { mainFrame },
} as never;

const invoke = (channel: string, event: unknown, payload: unknown) =>
  Promise.resolve().then(() => handlers.get(channel)!(event, payload));

beforeEach(() => {
  handlers.clear();
  shutdownHooks.length = 0;
  vi.clearAllMocks();
  registerIpcHandlers();
});

afterEach(() => {
  resetIpcHandlers();
});

describe('story 103 config channels', () => {
  it('registers rename, re-point and reorder as invoke handlers', () => {
    expect(handlers.has(CH.configRenameProject)).toBe(true);
    expect(handlers.has(CH.configRepointProject)).toBe(true);
    expect(handlers.has(CH.configReorderProjects)).toBe(true);
  });

  it.each([
    ['rename', 'configRenameProject' as const, { id: 'a', name: 'A' }],
    ['re-point', 'configRepointProject' as const, { id: 'a', path: '/tmp' }],
    ['reorder', 'configReorderProjects' as const, { ids: ['a'] }],
  ])('rejects a %s from a sender that is not the main frame', async (
    _label,
    channel,
    payload,
  ) => {
    await expect(invoke(CH[channel], untrustedEvent, payload)).rejects.toThrow();
  });

  it('guards the payload before the verb ever sees it', async () => {
    await expect(
      invoke(CH.configRenameProject, trustedEvent, {
        id: 'a',
        name: 'b',
        extra: 1,
      }),
    ).rejects.toThrow(/unexpected key/);
    expect(config.renameProject).not.toHaveBeenCalled();
  });

  it('passes the parsed rename through and answers with the snapshot', async () => {
    const result = await invoke(CH.configRenameProject, trustedEvent, {
      id: 'a',
      name: '  Trimmed  ',
    });

    // Trimmed by the guard, so main and the renderer agree about what is blank.
    expect(config.renameProject).toHaveBeenCalledWith({
      id: 'a',
      name: 'Trimmed',
    });
    expect(result).toBe(snapshot);
  });

  it('passes the parsed re-point through and answers with the snapshot', async () => {
    const result = await invoke(CH.configRepointProject, trustedEvent, {
      id: 'a',
      path: '~/moved',
    });

    expect(config.repointProject).toHaveBeenCalledWith({
      id: 'a',
      path: '~/moved',
    });
    expect(result).toBe(snapshot);
  });

  it('passes the parsed reorder through and answers with the snapshot', async () => {
    const result = await invoke(CH.configReorderProjects, trustedEvent, {
      ids: ['a', 'b'],
    });

    expect(config.reorderProjects).toHaveBeenCalledWith({ ids: ['a', 'b'] });
    expect(result).toBe(snapshot);
  });

  it('refuses a reorder carrying a duplicate id', async () => {
    await expect(
      invoke(CH.configReorderProjects, trustedEvent, { ids: ['a', 'a'] }),
    ).rejects.toThrow(/duplicate id/);
    expect(config.reorderProjects).not.toHaveBeenCalled();
  });

  /*
    Settings › Advanced › Reload. It re-read the file and nothing else, so a
    skill edited on disk never reached an agent run (the plugin only
    regenerated on a terminal spawn) and a missed folder event left the
    scheduler's agent caches stale for good.
  */
  it('regenerates the skills plugin, re-lists agents and tells every surface before it answers', async () => {
    resetIpcHandlers();
    handlers.clear();
    const emit = vi.fn();
    registerIpcHandlers({ emit });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const listsBefore = agentsList.mock.calls.length;
    const syncsBefore = skillsSync.mock.calls.length;

    let finishSync!: () => void;
    skillsSync.mockImplementationOnce(
      () => new Promise((resolve) => (finishSync = () => resolve({} as never))),
    );
    let answered = false;
    const reply = invoke(CH.configReload, trustedEvent, undefined).then((result) => {
      answered = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(skillsSync.mock.calls.length).toBe(syncsBefore + 1);
    expect(answered).toBe(false);

    finishSync();
    const result = await reply;

    expect(config.reloadConfig).toHaveBeenCalledTimes(1);
    expect(agentsList.mock.calls.length).toBeGreaterThan(listsBefore);
    expect(emit).toHaveBeenCalledWith(CH.agentsChanged, undefined);
    expect(emit).toHaveBeenCalledWith(CH.configChanged, snapshot);
    expect(result).toEqual({ ...snapshot, restartRequired: [] });
  });

  it('names the launch-only fields a reload read but cannot apply', async () => {
    vi.mocked(config.reloadConfig).mockReturnValueOnce({
      ...snapshot,
      importLoginEnv: !snapshot.importLoginEnv,
    });

    const result = await invoke(CH.configReload, trustedEvent, undefined);

    expect(result).toMatchObject({ restartRequired: ['login environment'] });
  });

  it('refuses a re-point that tries to name a second path', async () => {
    await expect(
      invoke(CH.configRepointProject, trustedEvent, {
        id: 'a',
        path: '/tmp',
        to: '/etc',
      }),
    ).rejects.toThrow(/unexpected key/);
    expect(config.repointProject).not.toHaveBeenCalled();
  });
});

describe('cli:codex-models', () => {
  it("answers the Codex adapter's models to a trusted sender only", async () => {
    await expect(invoke(CH.cliCodexModels, trustedEvent, undefined)).resolves.toEqual([
      { slug: 'gpt-6-luna', description: 'Fast.', defaultEffort: 'medium', efforts: ['low', 'medium'] },
    ]);
    await expect(invoke(CH.cliCodexModels, untrustedEvent, undefined)).rejects.toThrow();
  });
});

describe('harness:detect, harness:rescan and config:set-cli-sessions (HIVE-375)', () => {
  it('answers detection to a trusted sender, with the env a top-level session sees', async () => {
    await expect(invoke(CH.harnessDetect, trustedEvent, undefined)).resolves.toEqual(detected);
    await expect(invoke(CH.harnessRescan, trustedEvent, undefined)).resolves.toEqual(detected);
    await expect(invoke(CH.harnessDetect, untrustedEvent, undefined)).rejects.toThrow();

    const deps = vi.mocked(detect.detectClis).mock.calls[0]![0];
    expect(deps.command('claude-code')).toBe(snapshot.claudeCommand);
    expect(deps.command('codex')).toBe('codex');
    await expect(deps.env()).resolves.toMatchObject({ PATH: process.env.PATH });
    expect(vi.mocked(detect.rescanClis).mock.calls[0]![0]).toBe(deps);
  });

  it('diagnoses the command of the CLI it is asked about (HIVE-376)', async () => {
    vi.mocked(config.getConfig).mockReturnValueOnce({
      ...snapshot,
      clis: resolveClis({ copilot: { command: 'copilot-x --banner' } }),
    });
    await expect(invoke(CH.configDiagnoseCommand, trustedEvent, { cli: 'copilot' })).resolves.toMatchObject({
      command: 'copilot-x',
    });
  });

  it('writes sessions through the guard, and refuses a payload it does not know', async () => {
    await invoke(CH.configSetCliSessions, trustedEvent, { sessions: { codex: false }, defaultCli: null });
    expect(config.setCliSessions).toHaveBeenCalledWith({ sessions: { codex: false }, defaultCli: null });
    await expect(invoke(CH.configSetCliSessions, trustedEvent, { sessions: { gemini: false } })).rejects.toThrow();
  });
});

describe('config:set-cli and harness:sign-in (HIVE-376)', () => {
  it('writes a CLI through the guard, and refuses a command on claude-code', async () => {
    await invoke(CH.configSetCli, trustedEvent, { cli: 'codex', command: 'codex-x' });
    expect(config.setCli).toHaveBeenCalledWith({ cli: 'codex', command: 'codex-x' });
    await expect(invoke(CH.configSetCli, trustedEvent, { cli: 'claude-code', command: 'x' })).rejects.toThrow();
    await expect(invoke(CH.configSetCli, untrustedEvent, { cli: 'codex', command: 'x' })).rejects.toThrow();
  });

  it('reads a sign-in for a trusted sender only, with the command detection probes', async () => {
    await expect(invoke(CH.harnessSignIn, trustedEvent, { cli: 'copilot' })).resolves.toEqual({
      state: 'in',
      label: 'GitHub: octo',
    });
    const [cli, deps] = vi.mocked(signIn.readSignIn).mock.calls[0]!;
    expect(cli).toBe('copilot');
    expect(deps.command).toBe('copilot');
    expect(typeof deps.gh).toBe('function');
    await expect(invoke(CH.harnessSignIn, untrustedEvent, { cli: 'codex' })).rejects.toThrow();
    await expect(invoke(CH.harnessSignIn, trustedEvent, { cli: 'gemini' })).rejects.toThrow();
  });
});

describe('app:info gateOff (HIVE-265)', () => {
  afterEach(() => {
    electronApp.isPackaged = false;
    vi.unstubAllEnvs();
  });

  it('is absent in a packaged build, even with HIVE_E2E set', async () => {
    electronApp.isPackaged = true;
    vi.stubEnv('HIVE_E2E', '1');
    await expect(invoke(CH.appInfo, trustedEvent, undefined)).resolves.not.toHaveProperty('gateOff');
  });

  it('is true unpackaged with HIVE_E2E set', async () => {
    vi.stubEnv('HIVE_E2E', '1');
    await expect(invoke(CH.appInfo, trustedEvent, undefined)).resolves.toMatchObject({ gateOff: true });
  });

  it('is absent unpackaged when HIVE_E2E is empty', async () => {
    vi.stubEnv('HIVE_E2E', '');
    await expect(invoke(CH.appInfo, trustedEvent, undefined)).resolves.not.toHaveProperty('gateOff');
  });
});
