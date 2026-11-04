import { describe, expect, it } from 'vitest';

import { cliAvailability, resolveSessionCli, TURNED_OFF, unavailableReasons } from '@lib/harness/session-cli';
import { resolveClis } from '@shared/cli-contract';

const all = cliAvailability(null, null);
const no = (reason: string) => ({ ok: false as const, reason });

describe('cliAvailability (HIVE-375)', () => {
  it('counts every CLI available with no detection and no config (D10)', () => {
    expect(all).toEqual({ 'claude-code': { ok: true }, codex: { ok: true }, copilot: { ok: true } });
    expect(unavailableReasons(all)).toEqual({});
  });

  it('gives the missing reason first, then turned off', () => {
    const availability = cliAvailability(
      {
        'claude-code': { path: '/c', version: '1' },
        codex: { missing: '`codex` was not found on PATH.' },
        copilot: { path: '/p', version: null },
      },
      resolveClis({ codex: { sessions: false }, copilot: { sessions: false } }),
    );
    expect(availability['claude-code']).toEqual({ ok: true });
    expect(availability.codex).toEqual(no('`codex` was not found on PATH.'));
    expect(availability.copilot).toEqual(no(TURNED_OFF));
    expect(TURNED_OFF).toBe('turned off in Settings › Harnesses');
    expect(unavailableReasons(availability)).toEqual({
      codex: '`codex` was not found on PATH.',
      copilot: 'turned off in Settings › Harnesses',
    });
  });
});

describe('resolveSessionCli (D2)', () => {
  const offClaude = { ...all, 'claude-code': no('off') };

  it('takes the pick, then the default, then claude-code, then the first available', () => {
    expect(resolveSessionCli('copilot', 'codex', all)).toBe('copilot');
    expect(resolveSessionCli(null, 'codex', all)).toBe('codex');
    expect(resolveSessionCli(null, undefined, all)).toBe('claude-code');
    expect(resolveSessionCli(null, undefined, offClaude)).toBe('codex');
    expect(resolveSessionCli('claude-code', 'copilot', offClaude)).toBe('copilot');
  });

  it('answers null when nothing is available', () => {
    const none = { 'claude-code': no('a'), codex: no('b'), copilot: no('c') };
    expect(resolveSessionCli(null, undefined, none)).toBeNull();
  });
});
