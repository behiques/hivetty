// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { emptySnapshot } from '../../../shared/config-contract';

/**
 * Core loads and registers with no Electron at all (HIVE-422).
 *
 * `electron` is mocked to throw the moment anything imports it, and the
 * platform has no `desktop`, as a server's will not. Registration must still
 * complete, and every channel a client may send that this process answers
 * remotely must have a handler in the remote registry: no handler leaves core
 * because it needed a screen.
 *
 * A failure names the file that still imports Electron (the thrown message
 * travels up the import chain) or the channel with no handler.
 */

vi.mock('electron', () => {
  throw new Error('electron was imported by core');
});

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

const { CH } = await import('../../../shared/ipc-contract');
const { REMOTE_REFUSED_CHANNELS, frameKindOf, isProcessLocal } = await import('../../../shared/remote-contract');
const { resetPlatform, setPlatform } = await import('../../../core/platform');
const { registerIpcHandlers, remoteRegistryHas, resetIpcHandlers } = await import('../../../core/ipc');

/** Plain objects and a temp folder: what a server hands core. */
function headlessPlatform(): import('../../../core/platform').Platform {
  return {
    secrets: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
    paths: {
      stateDir: mkdtempSync(join(tmpdir(), 'hive-headless-')),
      logsDir: join(tmpdir(), 'hive-headless-logs'),
    },
    notify: () => undefined,
    processHost: () => {
      throw new Error('no pty host in this suite');
    },
    mcpLaunch: { command: process.execPath, args: ['/nowhere/mcp-host.js'], env: {} },
    lifecycle: { version: '0.0.0', isPackaged: false, quit: () => undefined },
  };
}

afterEach(() => {
  resetIpcHandlers();
  resetPlatform();
});

describe('core with no Electron and no desktop (HIVE-422)', () => {
  it('registers every handler without importing Electron', () => {
    setPlatform(headlessPlatform());

    expect(() => registerIpcHandlers()).not.toThrow();
  });

  it('has a remote handler for every channel a client may send', () => {
    setPlatform(headlessPlatform());
    registerIpcHandlers();

    const remote = Object.values(CH).filter((channel) => {
      const kind = frameKindOf(channel);
      return (kind === 'call' || kind === 'notify') && !isProcessLocal(channel) && !REMOTE_REFUSED_CHANNELS.has(channel);
    });
    const missing = remote.filter((channel) => !remoteRegistryHas(channel));

    expect(remote.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
