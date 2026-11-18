// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { applyHome } from '../../server/home';

const home = () => '/Users/ana';

describe('applyHome (HIVE-422)', () => {
  it('defaults to ~/.hivetty and points config and goals into it', () => {
    const env: NodeJS.ProcessEnv = {};
    const mkdir = vi.fn();
    expect(applyHome(env, home, mkdir)).toBe('/Users/ana/.hivetty/data');
    expect(env.HIVE_CONFIG_PATH).toBe('/Users/ana/.hivetty/config.json');
    expect(env.HIVE_GOALS_DIR).toBe('/Users/ana/.hivetty/goals');
  });

  it('follows HIVETTY_HOME', () => {
    const env: NodeJS.ProcessEnv = { HIVETTY_HOME: '/srv/h' };
    expect(applyHome(env, home, vi.fn())).toBe('/srv/h/data');
    expect(env.HIVE_CONFIG_PATH).toBe('/srv/h/config.json');
    expect(env.HIVE_GOALS_DIR).toBe('/srv/h/goals');
  });

  it('leaves an explicit HIVE_CONFIG_PATH and HIVE_GOALS_DIR alone', () => {
    const env: NodeJS.ProcessEnv = { HIVETTY_HOME: '/srv/h', HIVE_CONFIG_PATH: '/etc/hive.json', HIVE_GOALS_DIR: '/g' };
    applyHome(env, home, vi.fn());
    expect(env.HIVE_CONFIG_PATH).toBe('/etc/hive.json');
    expect(env.HIVE_GOALS_DIR).toBe('/g');
  });

  it('treats a blank HIVETTY_HOME or a blank default as unset', () => {
    const env: NodeJS.ProcessEnv = { HIVETTY_HOME: '  ', HIVE_CONFIG_PATH: '' };
    expect(applyHome(env, home, vi.fn())).toBe('/Users/ana/.hivetty/data');
    expect(env.HIVE_CONFIG_PATH).toBe('/Users/ana/.hivetty/config.json');
  });

  it('creates the data folder once', () => {
    const mkdir = vi.fn();
    applyHome({ HIVETTY_HOME: '/srv/h' }, home, mkdir);
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(mkdir).toHaveBeenCalledWith('/srv/h/data');
  });

  it('creates the folder for real by default, private to its owner', async () => {
    const { mkdtempSync, rmSync, statSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'hive-home-'));
    try {
      const data = applyHome({ HIVETTY_HOME: join(root, 'h') });
      expect(statSync(data).isDirectory()).toBe(true);
      expect(statSync(data).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
