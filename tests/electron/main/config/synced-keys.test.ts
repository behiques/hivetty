// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  onConfigChange,
  readConfigDocument,
  reloadConfig,
  writeSyncedKeys,
} from '../../../../electron/main/config';
import { WriteRefused } from '../../../../electron/main/config/write';
import { CONFIG_PATH_ENV } from '../../../../electron/shared/config-contract';

/**
 * The two doors settings sync uses into config.json (HIVE-284): the raw document it reads listed keys from,
 * and a write that runs the same parsing and validation every other verb does and tells the same listeners.
 */

let dir: string;
let path: string;
const originalConfigPath = process.env[CONFIG_PATH_ENV];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hive-config-sync-'));
  path = join(dir, 'config.json');
  process.env[CONFIG_PATH_ENV] = path;
  writeFileSync(path, `${JSON.stringify({ version: 2, projects: [], claudeCommand: 'claude', futureKey: { a: 1 } })}\n`);
  reloadConfig();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalConfigPath === undefined) delete process.env[CONFIG_PATH_ENV];
  else process.env[CONFIG_PATH_ENV] = originalConfigPath;
});

describe('readConfigDocument', () => {
  it('answers the file as JSON parsed it, an unknown key intact', () => {
    expect(readConfigDocument()).toEqual({ version: 2, projects: [], claudeCommand: 'claude', futureKey: { a: 1 } });
  });

  it('answers null when the file cannot be read or parsed', () => {
    writeFileSync(path, '{');
    expect(readConfigDocument()).toBeNull();
    writeFileSync(path, '[1]');
    expect(readConfigDocument()).toBeNull();
    rmSync(path);
    expect(readConfigDocument()).toBeNull();
  });
});

describe('writeSyncedKeys', () => {
  it('writes the mutation, tells the config listeners and answers the snapshot', () => {
    const heard = vi.fn();
    const off = onConfigChange(heard);
    const snapshot = writeSyncedKeys((draft) => ({ ...draft, claudeCommand: 'claude-beta' }));
    expect(snapshot).not.toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    expect((JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>).claudeCommand).toBe('claude-beta');
    off();
  });

  it('answers null and tells nobody when the write is refused', () => {
    const heard = vi.fn();
    const off = onConfigChange(heard);
    expect(
      writeSyncedKeys(() => {
        throw new WriteRefused('no');
      }),
    ).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    off();
  });

  it('answers null when the file cannot be read', () => {
    rmSync(path);
    expect(writeSyncedKeys((draft) => draft)).toBeNull();
  });
});
