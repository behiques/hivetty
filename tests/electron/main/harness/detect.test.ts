// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectCli, detectClis, rescanClis, resetCliDetection, runVersion, type RunVersion } from '../../../../electron/main/harness/detect';
import type { HarnessId } from '../../../../electron/shared/harness-contract';

let dir: string;
const bin = (name: string, mode = 0o755) => {
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, mode);
  return path;
};
const answer = (out: Partial<Awaited<ReturnType<RunVersion>>>): RunVersion =>
  vi.fn(async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...out }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'detect-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('detectCli (HIVE-375)', () => {
  it('finds the binary on PATH and reads its version', async () => {
    const path = bin('codex');
    const run = answer({ stdout: 'codex-cli 0.165.2\n' });
    await expect(detectCli('codex', { PATH: dir }, run)).resolves.toEqual({ path, version: '0.165.2' });
    expect(run).toHaveBeenCalledWith(path, ['--version'], 5_000);
  });

  it('probes only the first word of a command that carries arguments (D4)', async () => {
    const path = bin('claude');
    const run = answer({ stdout: '2.1.31 (Claude Code)' });
    await expect(detectCli('claude --tel', { PATH: dir }, run)).resolves.toEqual({ path, version: '2.1.31' });
  });

  it('skips leading NAME=value words and probes the binary after them (D4)', async () => {
    const path = bin('claude');
    const run = answer({ stdout: '2.1.31 (Claude Code)' });
    await expect(detectCli('FOO=1 claude --tel', { PATH: dir, FOO: 'x' }, run)).resolves.toEqual({
      path,
      version: '2.1.31',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(path, ['--version'], 5_000);
  });

  it('expands a leading ~/ to the home directory, and only a leading one (D4)', async () => {
    const home = process.env.HOME;
    process.env.HOME = dir;
    try {
      const path = bin('claude');
      const run = answer({ stdout: '2.1.31' });
      await expect(detectCli('~/claude', { PATH: '' }, run)).resolves.toEqual({ path, version: '2.1.31' });
      expect(run).toHaveBeenCalledWith(path, ['--version'], 5_000);

      const other = answer({});
      await expect(detectCli('a/~/claude', { PATH: dir }, other)).resolves.toMatchObject({ missing: expect.any(String) });
      expect(other).not.toHaveBeenCalled();
    } finally {
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
    }
  });

  it.each([
    '$HOME/bin/claude',
    '${HOME}/bin/claude',
    'env FOO=1 claude',
    'FOO="a b" claude',
    "FOO='a b' claude",
    'PATH=/x:$PATH claude',
    'A=1;claude',
    'claude | tee log',
    '~me/bin/claude',
    '`which claude`',
  ])('cannot check %s without a shell, so says so and runs nothing (HIVE-375 follow-up)', async (command) => {
    bin('claude');
    const run = answer({});
    await expect(detectCli(command, { PATH: dir }, run)).resolves.toEqual({
      unchecked: `HiveTTY can't check \`${command}\` without a shell. Sessions still run it as written.`,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a command of only NAME=value words as missing, and runs nothing', async () => {
    bin('claude');
    const run = answer({});
    await expect(detectCli('FOO=1 BAR=2', { PATH: dir }, run)).resolves.toEqual({ missing: 'No command is configured.' });
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves the sentence’s full stop off a version (HIVE-375, seen on Copilot)', async () => {
    bin('copilot');
    await expect(
      detectCli('copilot', { PATH: dir }, answer({ stdout: 'GitHub Copilot CLI 1.0.105.\nRun copilot update.' })),
    ).resolves.toMatchObject({ version: '1.0.105' });
    await expect(detectCli('copilot', { PATH: dir }, answer({ stdout: '2.0.0-beta.1+build.7' }))).resolves.toMatchObject({
      version: '2.0.0-beta.1+build.7',
    });
  });

  it('reads the version off stderr when stdout has none, and is still found without one', async () => {
    bin('copilot');
    await expect(detectCli('copilot', { PATH: dir }, answer({ stderr: 'v1.0.105' }))).resolves.toMatchObject({
      version: '1.0.105',
    });
    await expect(detectCli('copilot', { PATH: dir }, answer({ stdout: 'hello' }))).resolves.toMatchObject({
      version: null,
    });
  });

  it('says why when it is not on PATH, and runs nothing', async () => {
    const run = answer({});
    await expect(detectCli('copilot', { PATH: dir }, run)).resolves.toEqual({
      missing: '`copilot` was not found on PATH.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('says why for an absolute path that is not executable, and for an empty command', async () => {
    const path = bin('claude', 0o644);
    await expect(detectCli(path, { PATH: '' }, answer({}))).resolves.toEqual({
      missing: `\`${path}\` is not an executable file.`,
    });
    await expect(detectCli('  ', { PATH: dir }, answer({}))).resolves.toEqual({ missing: 'No command is configured.' });
  });

  it('turns a timeout, a non-zero exit and an exec error into a reason', async () => {
    bin('codex');
    await expect(detectCli('codex', { PATH: dir }, answer({ code: null, timedOut: true }))).resolves.toEqual({
      missing: '`codex --version` did not answer within 5s.',
    });
    await expect(detectCli('codex', { PATH: dir }, answer({ code: 2 }))).resolves.toEqual({
      missing: '`codex --version` exited 2.',
    });
    const boom: RunVersion = vi.fn(async () => {
      throw new Error('spawn EACCES');
    });
    await expect(detectCli('codex', { PATH: dir }, boom)).resolves.toEqual({ missing: 'spawn EACCES' });
  });
});

describe('runVersion (HIVE-375)', () => {
  const script = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };

  it('answers the output and the exit code, without a shell', async () => {
    await expect(runVersion(script('ok', 'echo "1.2.3 $1"'), ['--version'], 5_000)).resolves.toEqual({
      code: 0,
      stdout: '1.2.3 --version\n',
      stderr: '',
      timedOut: false,
    });
    await expect(runVersion(script('bad', 'echo nope >&2; exit 3'), [], 5_000)).resolves.toMatchObject({
      code: 3,
      stderr: 'nope\n',
      timedOut: false,
    });
  });

  it('passes an env when given one, and the parent’s otherwise (HIVE-372)', async () => {
    const echo = script('env', 'printf "%s" "$HIVE_TEST_VAR"');
    await expect(runVersion(echo, [], 5_000, { env: { ...process.env, HIVE_TEST_VAR: 'given' } })).resolves.toMatchObject({
      stdout: 'given',
    });
    await expect(runVersion(echo, [], 5_000)).resolves.toMatchObject({ stdout: process.env['HIVE_TEST_VAR'] ?? '' });
  });

  it('kills a run that outlives the timeout', async () => {
    await expect(runVersion(script('slow', 'exec sleep 30'), [], 100)).resolves.toMatchObject({
      code: null,
      timedOut: true,
    });
  });

  it('is bounded even when a child it left behind holds the output open', async () => {
    const started = Date.now();
    const out = await runVersion(script('forks', 'sleep 30 &\necho 1.2.3'), [], 300);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(out).toMatchObject({ code: 0, stdout: '1.2.3\n', timedOut: false });
  });

  it('is bounded on a timeout even when a child it started holds the output open', async () => {
    const started = Date.now();
    const out = await runVersion(script('hangs', 'sleep 30 &\nexec sleep 30'), [], 200);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(out).toMatchObject({ code: null, timedOut: true });
  });

  it('answers a signal it did not send, and never the raw output, as a reason', async () => {
    const path = script('crash', 'echo secret-stderr >&2; kill -SEGV $$');
    await expect(runVersion(path, [], 5_000)).resolves.toMatchObject({ code: null, signal: 'SIGSEGV', timedOut: false });
    const found = await detectCli(path, { PATH: '' }, runVersion);
    expect(found).toEqual({ missing: '`crash --version` was killed by SIGSEGV.' });
  });

  it('rejects when the file cannot be run', async () => {
    await expect(runVersion(join(dir, 'absent'), [], 5_000)).rejects.toThrow(/ENOENT/);
  });
});

describe('detectClis (HIVE-375)', () => {
  afterEach(() => resetCliDetection());

  it('answers all three, waiting for the env, and runs once per app run', async () => {
    bin('claude');
    bin('codex');
    const run = answer({ stdout: '1.2.3' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = {
      env: async () => {
        await gate;
        return { PATH: dir };
      },
      command: (id: HarnessId) => (id === 'claude-code' ? 'claude --tel' : id),
      run,
    };

    const pending = detectClis(deps);
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    release();
    const first = await pending;
    await detectClis(deps);

    expect(first).toEqual({
      'claude-code': { path: join(dir, 'claude'), version: '1.2.3' },
      codex: { path: join(dir, 'codex'), version: '1.2.3' },
      copilot: { missing: '`copilot` was not found on PATH.' },
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rescan drops the memo and looks again', async () => {
    const deps = { env: async () => ({ PATH: dir }), command: (id: HarnessId) => (id === 'claude-code' ? 'claude' : id), run: answer({ stdout: '1.0.0' }) };
    expect((await detectClis(deps)).copilot).toEqual({ missing: '`copilot` was not found on PATH.' });
    bin('copilot');
    expect((await rescanClis(deps)).copilot).toEqual({ path: join(dir, 'copilot'), version: '1.0.0' });
  });

  it('probes the configured command for each CLI (HIVE-376)', async () => {
    bin('claude');
    bin('codex-x');
    bin('copilot');
    const run = answer({ stdout: '1.2.3' });
    const command = (id: HarnessId) => (id === 'codex' ? 'codex-x --flag' : id === 'copilot' ? 'copilot' : 'claude');

    const found = await detectClis({ env: async () => ({ PATH: dir }), command, run });

    expect(found.codex).toEqual({ path: join(dir, 'codex-x'), version: '1.2.3' });
    expect(vi.mocked(run).mock.calls.map((call) => call[0])).toContain(join(dir, 'codex-x'));
  });

  it('does not keep a failed read', async () => {
    const env = vi.fn().mockRejectedValueOnce(new Error('login shell')).mockResolvedValue({ PATH: dir });
    const deps = { env, command: (id: HarnessId) => (id === 'claude-code' ? 'claude' : id), run: answer({}) };
    await expect(detectClis(deps)).rejects.toThrow('login shell');
    await expect(detectClis(deps)).resolves.toMatchObject({ codex: { missing: '`codex` was not found on PATH.' } });
  });
});
