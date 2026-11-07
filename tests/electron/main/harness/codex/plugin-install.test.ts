// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCodexPluginInstaller,
  readCodexPluginState,
} from '../../../../../electron/main/harness/codex/plugin-install';

const ok = { code: 0, stdout: '', stderr: '', timedOut: false };
const INSTALLED = '[marketplaces.hivetty]\nsource_type = "local"\nsource = "/m"\n\n[plugins."hive@hivetty"]\nenabled = true\n';

describe('the Codex plugin installer (HIVE-372)', () => {
  let home: string;
  let wanted: boolean;
  const run = vi.fn(async (..._args: unknown[]) => ok);
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    wanted = false;
    run.mockClear();
    run.mockImplementation(async () => ok);
  });
  const installer = (marketplace: { dir: string; version: string } | null = { dir: '/m', version: '1.0.0+abcd1234' }) =>
    createCodexPluginInstaller({
      run: run as never,
      command: () => ({ path: '/bin/codex' }),
      codexHome: () => home,
      marketplace: () => marketplace,
      wanted: () => wanted,
    });
  const args = () => run.mock.calls.map((call) => (call[1] as string[]).join(' '));
  const cached = (version: string) =>
    mkdirSync(join(home, 'plugins', 'cache', 'hivetty', 'hive', version), { recursive: true });

  it('reads config.toml read-only: nothing, both tables, a malformed file', () => {
    expect(readCodexPluginState(home)).toEqual({ installed: false, enabled: false, marketplace: false });
    writeFileSync(join(home, 'config.toml'), INSTALLED);
    expect(readCodexPluginState(home)).toEqual({ installed: true, enabled: true, marketplace: true });
    writeFileSync(join(home, 'config.toml'), '[[[');
    expect(readCodexPluginState(home)).toEqual({ installed: false, enabled: false, marketplace: false });
  });

  it('runs nothing when off and nothing is installed', async () => {
    expect(await installer().reconcile()).toEqual({ state: 'off' });
    expect(run).not.toHaveBeenCalled();
  });

  it('installs: marketplace add, then plugin add', async () => {
    wanted = true;
    expect(await installer().reconcile()).toEqual({ state: 'installed', version: '1.0.0+abcd1234' });
    expect(args()).toEqual(['plugin marketplace add /m', 'plugin add hive@hivetty']);
    expect(run.mock.calls[0]?.[0]).toBe('/bin/codex');
  });

  it('runs nothing when the installed version is current', async () => {
    wanted = true;
    writeFileSync(join(home, 'config.toml'), INSTALLED);
    cached('1.0.0+abcd1234');
    expect(await installer().reconcile()).toEqual({ state: 'installed', version: '1.0.0+abcd1234' });
    expect(run).not.toHaveBeenCalled();
  });

  it('updates a stale version with the same two idempotent commands', async () => {
    wanted = true;
    writeFileSync(join(home, 'config.toml'), INSTALLED);
    cached('0.9.0+00000000');
    await installer().reconcile();
    expect(args()).toEqual(['plugin marketplace add /m', 'plugin add hive@hivetty']);
  });

  it('removes: plugin first, then the marketplace (marketplace remove leaves the plugin table behind)', async () => {
    writeFileSync(join(home, 'config.toml'), INSTALLED);
    expect(await installer().reconcile()).toEqual({ state: 'off' });
    expect(args()).toEqual(['plugin remove hive@hivetty', 'plugin marketplace remove hivetty']);
  });

  it('removes a marketplace left alone by a half install', async () => {
    writeFileSync(join(home, 'config.toml'), '[marketplaces.hivetty]\nsource = "/m"\n');
    await installer().reconcile();
    expect(args()).toEqual(['plugin marketplace remove hivetty']);
  });
});
