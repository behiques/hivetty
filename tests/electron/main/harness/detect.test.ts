// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectCli, runVersion, type RunVersion } from '../../../../electron/main/harness/detect';

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

  it('kills a run that outlives the timeout', async () => {
    await expect(runVersion(script('slow', 'sleep 5'), [], 100)).resolves.toMatchObject({ code: null, timedOut: true });
  });

  it('rejects when the file cannot be run', async () => {
    await expect(runVersion(join(dir, 'absent'), [], 5_000)).rejects.toThrow(/ENOENT/);
  });
});
