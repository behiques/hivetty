// @vitest-environment node
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return import('../../../../electron/main/config/paths');
};

describe('configPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to ~/.hivetty (HIVE-242)', async () => {
    vi.stubEnv('HIVE_CONFIG_PATH', '');
    const { configPath } = await load();
    expect(configPath()).toBe(join(homedir(), '.hivetty', 'config.json'));
  });

  it('moves to ~/.hivetty-dev for an unpackaged build (HIVE-227)', async () => {
    vi.stubEnv('HIVE_CONFIG_PATH', '');
    const { configPath, switchToDevHiveDir } = await load();
    switchToDevHiveDir();
    expect(configPath()).toBe(join(homedir(), '.hivetty-dev', 'config.json'));
  });

  it('lets HIVE_CONFIG_PATH win over both', async () => {
    vi.stubEnv('HIVE_CONFIG_PATH', '/tmp/elsewhere/config.json');
    const { configPath, switchToDevHiveDir } = await load();
    expect(configPath()).toBe('/tmp/elsewhere/config.json');
    switchToDevHiveDir();
    expect(configPath()).toBe('/tmp/elsewhere/config.json');
  });
});
