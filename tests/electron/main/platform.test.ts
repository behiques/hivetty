import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The desktop's platform adapter (HIVE-422).
 *
 * Every member reads Electron when it is read or called, never when the
 * adapter is built: the suites' `electron` mocks leave exports out, and a
 * missing export read at construction would throw in all of them.
 */

const getPath = vi.fn((name: string) => `/fake/${name}`);
const electron = vi.hoisted(() => ({ isPackaged: false }));
const safeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
};

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => getPath(name),
    getVersion: () => '9.9.9',
    get isPackaged() {
      return electron.isPackaged;
    },
    quit: vi.fn(),
  },
  safeStorage,
}));

const { createDesktopPlatform } = await import('../../../electron/main/platform');

beforeEach(() => {
  electron.isPackaged = false;
});

describe('createDesktopPlatform', () => {
  it('launches the MCP host with the app binary as Node', () => {
    const { mcpLaunch } = createDesktopPlatform();
    expect(mcpLaunch.command).toBe(process.execPath);
    expect(mcpLaunch.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(mcpLaunch.args).toHaveLength(1);
    expect(mcpLaunch.args[0]).toMatch(/mcp-host\.js$/);
  });

  it("reads the state folder from app.getPath('userData') and logs from 'logs'", () => {
    const { paths } = createDesktopPlatform();
    expect(paths.stateDir).toBe('/fake/userData');
    expect(paths.logsDir).toBe('/fake/logs');
  });

  it('follows app.isPackaged when read, not when built', () => {
    const p = createDesktopPlatform();
    expect(p.lifecycle.isPackaged).toBe(false);
    electron.isPackaged = true;
    expect(p.lifecycle.isPackaged).toBe(true);
  });

  it('reads the version from the app', () => {
    expect(createDesktopPlatform().lifecycle.version).toBe('9.9.9');
  });

  it("hands out Electron's safeStorage object itself", () => {
    expect(createDesktopPlatform().secrets).toBe(safeStorage);
  });

  it('points resources at the repository folder when unpackaged', () => {
    expect(createDesktopPlatform().resources).toMatch(/[/\\]resources$/);
  });

  it('points resources at process.resourcesPath when packaged', () => {
    electron.isPackaged = true;
    const original = process.resourcesPath;
    Object.defineProperty(process, 'resourcesPath', { value: '/Applications/X.app/Resources', configurable: true });
    try {
      expect(createDesktopPlatform().resources).toBe('/Applications/X.app/Resources');
    } finally {
      Object.defineProperty(process, 'resourcesPath', { value: original, configurable: true });
    }
  });

  it('calls no Electron function when it is built', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({}));
    const fresh = await import('../../../electron/main/platform');
    expect(() => fresh.createDesktopPlatform()).not.toThrow();
    vi.doUnmock('electron');
  });
});
