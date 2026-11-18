// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptySnapshot } from '../../../shared/config-contract';

/**
 * Registration with and without a screen (HIVE-422).
 *
 * `on()` and `handle()` fill the remote registry and the bindings record
 * first, and bind `ipcMain` only when the platform has a desktop. A server's
 * platform has none, so every handler still registers and answers through the
 * registry. Sender validation stays on the `ipcMain` path alone.
 */

/** Electron's own `ipcMain`. A platform with no desktop must never reach it. */
const electronIpcMain = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
  removeAllListeners: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0',
    on: vi.fn(),
    removeListener: vi.fn(),
    getPath: () => '/tmp/hive-test-registration',
  },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: electronIpcMain,
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
}));

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
  onShutdown: vi.fn(),
}));

const snapshot = emptySnapshot('/tmp/config.json', '/bin/zsh');

vi.mock('../../../core/config/index', () => ({
  getConfig: vi.fn(() => snapshot),
  onConfigChange: vi.fn(() => () => {}),
  reloadConfig: vi.fn(() => snapshot),
  loadConfig: vi.fn(() => snapshot),
  addProject: vi.fn(() => snapshot),
  removeProject: vi.fn(() => snapshot),
  renameProject: vi.fn(() => snapshot),
  repointProject: vi.fn(() => snapshot),
  reorderProjects: vi.fn(() => snapshot),
  configPath: vi.fn(() => '/tmp/config.json'),
}));

/** The registry `core/ipc/index.ts` builds, captured so a test can call through it as a socket would. */
const captured = vi.hoisted(() => ({ registry: null as null | import('../../../core/ipc/registry').IpcRegistry }));

vi.mock('../../../core/ipc/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/ipc/registry')>();
  return {
    ...actual,
    createIpcRegistry: () => {
      captured.registry = actual.createIpcRegistry();
      return captured.registry;
    },
  };
});

const { CH } = await import('../../../shared/ipc-contract');
const { resetPlatform, setPlatform } = await import('../../../core/platform');
const { ipcBindingsSize, IpcSenderError, registerIpcHandlers, remoteRegistrySize, resetIpcHandlers } =
  await import('../../../core/ipc');

type Platform = import('../../../core/platform').Platform;
type Desktop = import('../../../core/platform').Desktop;

/** A platform built from plain objects, as a server's would be: no `desktop`. */
function headlessPlatform(): Platform {
  return {
    secrets: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
    paths: {
      stateDir: mkdtempSync(join(tmpdir(), 'hive-registration-')),
      logsDir: join(tmpdir(), 'hive-registration-logs'),
    },
    resources: join(tmpdir(), 'hive-registration-resources'),
    notify: () => undefined,
    processHost: () => {
      throw new Error('no pty host in this suite');
    },
    mcpLaunch: { command: process.execPath, args: ['/nowhere/mcp-host.js'], env: {} },
    lifecycle: { version: '0.0.0', isPackaged: false, quit: () => undefined },
  };
}

/** A recording `ipcMain`, keeping the handler each channel was bound to. */
function recordingIpcMain() {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  return {
    handlers,
    listeners,
    ipcMain: {
      on: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
        listeners.set(channel, listener);
      }),
      handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  };
}

function withDesktop(ipcMain: Desktop['ipcMain']): Platform {
  return { ...headlessPlatform(), desktop: { ipcMain, broadcaster: { emit: () => undefined } } as Desktop };
}

const reporter = { on: () => undefined };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetIpcHandlers();
  resetPlatform();
});

describe('registration with no desktop (HIVE-422)', () => {
  it('registers every handler without throwing and fills the remote registry', () => {
    setPlatform(headlessPlatform());

    expect(() => registerIpcHandlers()).not.toThrow();
    expect(remoteRegistrySize()).toBeGreaterThan(0);
  });

  it("never touches Electron's ipcMain", () => {
    setPlatform(headlessPlatform());
    registerIpcHandlers();
    resetIpcHandlers();

    expect(electronIpcMain.handle).not.toHaveBeenCalled();
    expect(electronIpcMain.on).not.toHaveBeenCalled();
    expect(electronIpcMain.removeHandler).not.toHaveBeenCalled();
    expect(electronIpcMain.removeAllListeners).not.toHaveBeenCalled();
  });

  it('records the same channels as a desktop does', () => {
    setPlatform(headlessPlatform());
    registerIpcHandlers();
    const headless = ipcBindingsSize();
    resetIpcHandlers();

    setPlatform(withDesktop(recordingIpcMain().ipcMain));
    registerIpcHandlers();

    expect(ipcBindingsSize()).toBe(headless);
    expect(headless).toBeGreaterThan(0);
  });
});

describe('registration with a desktop (HIVE-422)', () => {
  it('rejects a call from a subframe on the ipcMain path, and answers the same channel through the registry', async () => {
    const fake = recordingIpcMain();
    setPlatform(withDesktop(fake.ipcMain));
    registerIpcHandlers();

    const local = fake.handlers.get(CH.appInfo);
    expect(local).toBeDefined();
    const subframe = { senderFrame: { url: 'about:blank' }, sender: { mainFrame: { url: 'file:///x' }, on: () => undefined } };
    expect(() => local!(subframe, undefined)).toThrow(IpcSenderError);

    const remote = captured.registry?.call(CH.appInfo);
    expect(remote).not.toBeNull();
    await expect(Promise.resolve(remote!(undefined, reporter))).resolves.toMatchObject({ version: '0.0.0' });
  });

  it('rejects a send from a subframe on the ipcMain path too', () => {
    const fake = recordingIpcMain();
    setPlatform(withDesktop(fake.ipcMain));
    registerIpcHandlers();

    const local = fake.listeners.get(CH.ptyWrite);
    expect(local).toBeDefined();
    const subframe = { senderFrame: { url: 'about:blank' }, sender: { mainFrame: { url: 'file:///x' }, on: () => undefined } };
    expect(() => local!(subframe, { sessionId: 'x', data: 'y' })).toThrow(IpcSenderError);
  });
});
