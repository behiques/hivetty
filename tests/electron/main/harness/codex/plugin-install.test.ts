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

  it('stops at the first failure and carries Codex’s own stderr', async () => {
    wanted = true;
    run.mockImplementationOnce(async () => ok).mockImplementationOnce(async () => ({
      code: 1,
      stdout: '',
      stderr: 'Error: plugin `hive` was not found in marketplace `hivetty`\n',
      timedOut: false,
    }));
    expect(await installer().reconcile()).toEqual({
      state: 'failed',
      command: 'codex plugin add hive@hivetty',
      message: 'Error: plugin `hive` was not found in marketplace `hivetty`',
    });
  });

  it('stops before plugin add when marketplace add fails', async () => {
    wanted = true;
    run.mockImplementationOnce(async () => ({ code: 1, stdout: '', stderr: 'Error: bad\n', timedOut: false }));
    expect(await installer().reconcile()).toMatchObject({ state: 'failed', command: 'codex plugin marketplace add /m' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back to stdout, then to the exit code, when stderr is empty', async () => {
    wanted = true;
    run.mockImplementationOnce(async () => ({ code: 2, stdout: 'bad dir\n', stderr: '', timedOut: false }));
    expect(await installer().reconcile()).toMatchObject({ state: 'failed', message: 'bad dir' });
    run.mockImplementationOnce(async () => ({ code: 3, stdout: '', stderr: '', timedOut: false }));
    expect(await installer().reconcile()).toMatchObject({ state: 'failed', message: 'exited with code 3' });
  });

  it('reports a timeout', async () => {
    wanted = true;
    run.mockImplementationOnce(async () => ({ code: null, stdout: '', stderr: '', timedOut: true }) as never);
    expect(await installer().reconcile()).toMatchObject({ state: 'failed', message: 'timed out after 30 s' });
  });

  it('reports a codex command that cannot be resolved, and runs nothing', async () => {
    wanted = true;
    const broken = createCodexPluginInstaller({
      run: run as never,
      command: () => ({ problem: 'No codex command is configured.' }),
      codexHome: () => home,
      marketplace: () => ({ dir: '/m', version: 'v' }),
      wanted: () => true,
    });
    expect(await broken.reconcile()).toEqual({ state: 'failed', command: 'codex', message: 'No codex command is configured.' });
    expect(run).not.toHaveBeenCalled();
  });

  it('fails without running anything when the plugin folder was never written', async () => {
    wanted = true;
    expect(await installer(null).reconcile()).toEqual({
      state: 'failed',
      command: 'codex plugin add hive@hivetty',
      message: 'HiveTTY could not write the plugin folder.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers a thrown run as a failure and keeps serving the next reconcile', async () => {
    wanted = true;
    run.mockImplementationOnce(async () => {
      throw new Error('spawn EACCES');
    });
    const subject = installer();
    expect(await subject.reconcile()).toEqual({ state: 'failed', command: 'codex', message: 'Error: spawn EACCES' });
    expect(await subject.reconcile()).toEqual({ state: 'installed', version: '1.0.0+abcd1234' });
  });

  it('runs one reconcile at a time, and status() waits for the one in flight', async () => {
    wanted = true;
    let release!: () => void;
    run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok);
        }),
    );
    const subject = installer();
    const first = subject.reconcile();
    const second = subject.reconcile();
    const status = subject.status();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    await second;
    expect(await status).toEqual(await second);
  });

  it('answers status() asked before any reconcile by running one, not with a stale off', async () => {
    wanted = true;
    writeFileSync(join(home, 'config.toml'), INSTALLED);
    cached('1.0.0+abcd1234');
    expect(await installer().status()).toEqual({ state: 'installed', version: '1.0.0+abcd1234' });
    expect(run).not.toHaveBeenCalled();
  });
});
