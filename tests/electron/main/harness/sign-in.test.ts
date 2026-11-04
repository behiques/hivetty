// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunVersion } from '../../../../electron/main/harness/detect';
import { readSignIn } from '../../../../electron/main/harness/sign-in';

let dir: string;
let env: NodeJS.ProcessEnv;
const answer = (stdout: string, code = 0): RunVersion =>
  vi.fn(async () => ({ code, stdout, stderr: '', timedOut: false }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sign-in-'));
  for (const name of ['claude', 'codex']) {
    writeFileSync(join(dir, name), '#!/bin/sh\n');
    chmodSync(join(dir, name), 0o755);
  }
  env = { PATH: dir };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readSignIn (HIVE-376)', () => {
  it('Claude: the email and plan from `auth status`', async () => {
    const run = answer(JSON.stringify({ loggedIn: true, email: 'a@b.c', subscriptionType: 'max' }));
    expect(await readSignIn('claude-code', { command: 'claude', env, run })).toEqual({
      state: 'in',
      label: 'a@b.c · Max plan',
    });
    expect(run).toHaveBeenCalledWith(join(dir, 'claude'), ['auth', 'status'], 5_000);
    expect(
      await readSignIn('claude-code', {
        command: 'claude',
        env,
        run: answer(JSON.stringify({ loggedIn: true, email: 'a@b.c' })),
      }),
    ).toEqual({ state: 'in', label: 'a@b.c' });
  });

  it('Claude: signed out, and an answer that is not JSON', async () => {
    expect(await readSignIn('claude-code', { command: 'claude', env, run: answer('{"loggedIn":false}', 1) })).toEqual({
      state: 'out',
      label: 'Not signed in',
      fix: 'claude auth login',
    });
    expect((await readSignIn('claude-code', { command: 'claude', env, run: answer('Usage: …') })).state).toBe(
      'unknown',
    );
  });

  it('Codex: `login status` exit 0 is in, non-zero is out, and the raw line never escapes', async () => {
    expect(await readSignIn('codex', { command: 'codex', env, run: answer('Logged in using ChatGPT\n') })).toEqual({
      state: 'in',
      label: 'Signed in with ChatGPT',
    });
    expect(
      await readSignIn('codex', { command: 'codex', env, run: answer('Logged in using an API key - sk-…1234\n') }),
    ).toEqual({ state: 'in', label: 'Signed in with an API key' });
    expect(await readSignIn('codex', { command: 'codex', env, run: answer('Logged in\n') })).toEqual({
      state: 'in',
      label: 'Signed in',
    });
    expect(await readSignIn('codex', { command: 'codex', env, run: answer('Not logged in', 1) })).toEqual({
      state: 'out',
      label: 'Not signed in',
      fix: 'codex login',
    });
  });

  it('a missing binary, a timeout and a run that throws are unknown', async () => {
    expect((await readSignIn('codex', { command: 'nope', env, run: answer('') })).state).toBe('unknown');
    const slow: RunVersion = async () => ({ code: null, stdout: '', stderr: '', timedOut: true });
    expect(await readSignIn('codex', { command: 'codex', env, run: slow })).toEqual({
      state: 'unknown',
      label: '`codex login status` did not answer within 5s.',
    });
    const broken: RunVersion = async () => {
      throw new Error('EACCES');
    };
    expect(await readSignIn('claude-code', { command: 'claude --tel', env, run: broken })).toEqual({
      state: 'unknown',
      label: '`claude auth status` could not run.',
    });
  });

  it('Copilot: the gh account, else gh auth login', async () => {
    const gh = (authenticated: boolean, installed = true, account: string | null = authenticated ? 'octo' : null) =>
      () => ({ installed, authenticated, account });
    expect(await readSignIn('copilot', { command: 'copilot', env, gh: gh(true) })).toEqual({
      state: 'in',
      label: 'GitHub: octo',
    });
    expect(await readSignIn('copilot', { command: 'copilot', env, gh: gh(true, true, null) })).toEqual({
      state: 'in',
      label: 'Signed in to GitHub',
    });
    expect(await readSignIn('copilot', { command: 'copilot', env, gh: gh(false) })).toEqual({
      state: 'out',
      label: 'Not signed in to GitHub',
      fix: 'gh auth login',
    });
    expect((await readSignIn('copilot', { command: 'copilot', env, gh: gh(false, false) })).state).toBe('unknown');
    expect((await readSignIn('copilot', { command: 'copilot', env })).state).toBe('unknown');
  });
});
