import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_PICKS,
  cliAvailability,
  resolvePick,
  resolveSessionCli,
  TURNED_OFF,
  unavailableReasons,
} from '@lib/harness/session-cli';
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

describe('cliAvailability, a command detection cannot check (HIVE-375 follow-up)', () => {
  it('keeps the CLI available: only a session can run it', () => {
    const availability = cliAvailability(
      { 'claude-code': { unchecked: 'cannot check' }, codex: { path: '/x', version: null }, copilot: { path: '/p', version: null } },
      resolveClis({}),
    );
    expect(availability['claude-code']).toEqual({ ok: true });
  });

  it('still honours the switch', () => {
    const availability = cliAvailability(
      { 'claude-code': { unchecked: 'cannot check' }, codex: { path: '/x', version: null }, copilot: { path: '/p', version: null } },
      resolveClis({ 'claude-code': { sessions: false } }),
    );
    expect(availability['claude-code']).toEqual(no(TURNED_OFF));
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

describe('resolvePick (HIVE-376)', () => {
  const clis = resolveClis({ codex: { sessionModel: 'gpt-6-terra', sessionEffort: 'high' } });
  it('a pick wins, field by field', () => {
    expect(resolvePick('codex', { codex: { effort: 'low' } }, clis)).toEqual({ model: 'gpt-6-terra', effort: 'low' });
  });
  it('the configured default applies with no pick', () => {
    expect(resolvePick('codex', {}, clis)).toEqual({ model: 'gpt-6-terra', effort: 'high' });
  });
  it('the built-in pick applies when neither is set, and with no config', () => {
    expect(resolvePick('claude-code', {}, clis)).toEqual(BUILT_IN_PICKS['claude-code']);
    expect(resolvePick('copilot', {}, null)).toEqual(BUILT_IN_PICKS.copilot);
  });
});
