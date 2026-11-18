// @vitest-environment node
import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { PROD_CLOUD_URL, resolveCloudUrl } from '../../core/licence/cloud';
import { leaseKeys } from '../../core/licence/keys';
import { createServerPlatform, NO_SECRET_STORE } from '../../server/platform';
import { makeSigner } from '../support/lease';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  fork: vi.fn(() => Object.assign(new EventEmitter(), { pid: 77, connected: true, send: vi.fn(), kill: vi.fn() })),
}));

const make = (release = false, quit = vi.fn()) =>
  createServerPlatform({ dataDir: '/srv/h/data', release, version: '1.2.3', quit, fromDir: '/app/server' });

describe('the server platform (HIVE-422)', () => {
  it('has no secret store: encryption is unavailable and every use throws', () => {
    const { secrets } = make();
    expect(secrets.isEncryptionAvailable()).toBe(false);
    expect(() => secrets.encryptString('token')).toThrow(NO_SECRET_STORE);
    expect(() => secrets.decryptString(Buffer.from('x'))).toThrow(NO_SECRET_STORE);
  });

  it('keeps state and logs in the data folder', () => {
    expect(make().paths).toEqual({ stateDir: '/srv/h/data', logsDir: '/srv/h/data' });
  });

  it('finds resources two folders up from the bundle', () => {
    expect(make().resources).toBe('/resources');
    expect(
      createServerPlatform({ dataDir: '/d', release: false, version: '1', quit: vi.fn(), fromDir: '/repo/out/server' })
        .resources,
    ).toBe('/repo/resources');
  });

  it('notifies with one log line and nothing else', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const onClick = vi.fn();
    make().notify({ title: 'Agent done', body: 'builder finished', onClick });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[notify] Agent done: builder finished');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('forks the PTY host that sits beside the bundle', () => {
    vi.mocked(fork).mockClear();
    const host = make().processHost();
    expect(host.pid).toBe(77);
    expect(fork).toHaveBeenCalledWith('/app/server/pty-host.js', [], {
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
  });

  it('runs the host as the host user when one is given', () => {
    vi.mocked(fork).mockClear();
    createServerPlatform({
      dataDir: '/d',
      release: false,
      version: '1',
      quit: vi.fn(),
      fromDir: '/app/server',
      hostUser: { uid: 1001, gid: 1002 },
    }).processHost();
    expect(vi.mocked(fork).mock.calls[0]?.[2]).toMatchObject({ uid: 1001, gid: 1002 });
  });

  it('launches the MCP host with plain Node, no ELECTRON_RUN_AS_NODE', () => {
    expect(make().mcpLaunch).toEqual({ command: process.execPath, args: ['/app/server/mcp-host.js'], env: {} });
  });

  it('answers the lifecycle from its input, and has no desktop', () => {
    const quit = vi.fn();
    const platform = make(true, quit);
    expect(platform.lifecycle.version).toBe('1.2.3');
    expect(platform.lifecycle.isPackaged).toBe(true);
    platform.lifecycle.quit(3);
    expect(quit).toHaveBeenCalledWith(3);
    expect(platform.desktop).toBeUndefined();
  });

  it('defaults the bundle folder to its own', () => {
    const platform = createServerPlatform({ dataDir: '/d', release: false, version: '1', quit: vi.fn() });
    expect(platform.mcpLaunch.args[0]).toMatch(/\/server\/mcp-host\.js$/);
  });

  it('a release platform ignores the cloud and key escape hatches', () => {
    const { isPackaged } = make(true).lifecycle;
    const testJwk = makeSigner('kid-evil').jwk;
    expect(
      resolveCloudUrl({ isPackaged, prerelease: false, env: { HIVETTY_CLOUD_URL: 'http://evil.test' } }),
    ).toBe(PROD_CLOUD_URL);
    const keys = leaseKeys({ isPackaged, prerelease: false, env: { HIVETTY_LEASE_KEYS: JSON.stringify([testJwk]) } });
    expect(keys.map((key) => key.kid)).not.toContain('kid-evil');
  });

  it('a development platform follows the environment', () => {
    const { isPackaged } = make(false).lifecycle;
    const testJwk = makeSigner('kid-dev').jwk;
    expect(resolveCloudUrl({ isPackaged, prerelease: false, env: { HIVETTY_CLOUD_URL: 'http://local.test' } })).toBe(
      'http://local.test',
    );
    const keys = leaseKeys({ isPackaged, prerelease: false, env: { HIVETTY_LEASE_KEYS: JSON.stringify([testJwk]) } });
    expect(keys.map((key) => key.kid)).toContain('kid-dev');
  });
});
