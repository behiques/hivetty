import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_PICKS,
  cliAvailability,
  cliCaption,
  lockedClis,
  resolvePick,
  resolveSessionCli,
  type SessionCliChoice,
  TURNED_OFF,
  unavailableReasons,
} from '@lib/harness/session-cli';
import { resolveClis } from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';
import type { LicenceState } from '@shared/licence-contract';

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

describe('resolveSessionCli (HIVE-378)', () => {
  const off = (...ids: HarnessId[]) => ({ ...all, ...Object.fromEntries(ids.map((id) => [id, no(`${id} off`)])) });

  it('takes the run pick first, then the project, then your default, then claude-code', () => {
    expect(resolveSessionCli({ picked: 'copilot', project: 'codex', sessionsDefault: 'codex' }, all)).toEqual({
      cli: 'copilot',
      source: 'picked',
      skipped: [],
    });
    expect(resolveSessionCli({ picked: null, project: 'codex', sessionsDefault: 'copilot' }, all)).toMatchObject({
      cli: 'codex',
      source: 'project',
    });
    expect(resolveSessionCli({ picked: null, sessionsDefault: 'copilot' }, all)).toMatchObject({
      cli: 'copilot',
      source: 'yours',
    });
    expect(resolveSessionCli({ picked: null }, all)).toMatchObject({ cli: 'claude-code', source: 'yours' });
  });

  it.each([['missing'], ['turned off']])('skips a %s project CLI and says so', (reason) => {
    const availability = { ...all, codex: no(reason) };
    expect(resolveSessionCli({ picked: null, project: 'codex' }, availability)).toEqual({
      cli: 'claude-code',
      source: 'yours',
      skipped: [{ cli: 'codex', source: 'project', reason }],
    });
  });

  it('skips an unavailable pick and an unavailable default', () => {
    expect(resolveSessionCli({ picked: 'copilot', sessionsDefault: 'codex' }, off('copilot', 'codex'))).toEqual({
      cli: 'claude-code',
      source: 'fallback',
      skipped: [
        { cli: 'copilot', source: 'picked', reason: 'copilot off' },
        { cli: 'codex', source: 'yours', reason: 'codex off' },
      ],
    });
  });

  it('records every rung that named an unavailable CLI, even the same one twice', () => {
    expect(
      resolveSessionCli({ picked: null, project: 'codex', sessionsDefault: 'codex' }, off('codex')).skipped,
    ).toEqual([
      { cli: 'codex', source: 'project', reason: 'codex off' },
      { cli: 'codex', source: 'yours', reason: 'codex off' },
    ]);
    // A stale run pick that is also the project's CLI: the project's skip is still on record, so its row dims.
    expect(resolveSessionCli({ picked: 'copilot', project: 'copilot' }, off('copilot')).skipped).toEqual([
      { cli: 'copilot', source: 'picked', reason: 'copilot off' },
      { cli: 'copilot', source: 'project', reason: 'copilot off' },
    ]);
  });

  it('falls back to the first available CLI when every rung is out', () => {
    expect(resolveSessionCli({ picked: null }, off('claude-code'))).toMatchObject({ cli: 'codex', source: 'fallback' });
  });

  it('answers null when nothing is available', () => {
    expect(resolveSessionCli({ picked: null }, off('claude-code', 'codex', 'copilot'))).toMatchObject({
      cli: null,
      source: null,
    });
  });
});

describe('cliCaption (HIVE-378)', () => {
  const choice = (over: Partial<SessionCliChoice>): SessionCliChoice => ({
    cli: 'codex',
    source: 'yours',
    skipped: [],
    ...over,
  });

  it('names the source', () => {
    expect(cliCaption(choice({ source: 'project' }), 'hivetty')).toBe('Default for hivetty');
    expect(cliCaption(choice({ source: 'yours' }))).toBe('Your default');
    expect(cliCaption(choice({ source: 'picked' }))).toBeNull();
    expect(cliCaption(choice({ source: 'fallback' }))).toBeNull();
    expect(cliCaption(choice({ cli: null, source: null }))).toBeNull();
  });

  it('says what was skipped and what it starts on instead', () => {
    const skipped = [{ cli: 'copilot' as const, source: 'project' as const, reason: 'x' }];
    expect(cliCaption(choice({ cli: 'claude-code', source: 'yours', skipped }), 'incorpx')).toBe(
      "Copilot, the default for incorpx, isn't available · starting on Claude Code (your default)",
    );
    expect(
      cliCaption(choice({ cli: 'codex', source: 'fallback', skipped: [{ cli: 'claude-code', source: 'yours', reason: 'x' }] })),
    ).toBe("Claude Code, your default, isn't available · starting on Codex");
    expect(
      cliCaption(choice({ cli: 'codex', source: 'yours', skipped: [{ cli: 'copilot', source: 'picked', reason: 'x' }] })),
    ).toBe("Copilot, your pick, isn't available · starting on Codex (your default)");
  });

  it("names the project's skipped default before a stale run pick", () => {
    const skipped = [
      { cli: 'copilot' as const, source: 'picked' as const, reason: 'x' },
      { cli: 'codex' as const, source: 'project' as const, reason: 'y' },
    ];
    expect(cliCaption(choice({ cli: 'claude-code', source: 'yours', skipped }), 'incorpx')).toBe(
      "Codex, the default for incorpx, isn't available · starting on Claude Code (your default)",
    );
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

const SOLO = {
  kind: 'licensed',
  plan: 'solo',
  features: ['cli.codex'],
  limits: {},
  exp: 2_000_000_000,
  iat: 1_800_000_000,
} as LicenceState;

describe('cliAvailability: the plan lock (HIVE-332)', () => {
  it('locks a CLI the lease lacks, with its plan', () => {
    const availability = cliAvailability(null, null, SOLO);
    expect(availability.codex).toEqual({ ok: true });
    expect(availability.copilot).toEqual({ ok: false, reason: 'Copilot is in Team and above', plan: 'Team' });
    expect(lockedClis(availability)).toEqual({ copilot: 'Copilot is in Team and above' });
  });

  it('puts the lock before missing and turned off', () => {
    const availability = cliAvailability(
      {
        'claude-code': { path: '/c', version: '1' },
        codex: { path: '/x', version: '1' },
        copilot: { missing: 'no copilot' },
      },
      resolveClis({ copilot: { sessions: false } }),
      SOLO,
    );
    expect(availability.copilot).toMatchObject({ reason: 'Copilot is in Team and above' });
  });

  it('locks nothing with no licence (unread, the browser, gate off)', () => {
    expect(cliAvailability(null, null, null)).toEqual(all);
    expect(lockedClis(all)).toEqual({});
  });

  it('a missing CLI is unavailable but not locked', () => {
    const availability = cliAvailability(
      {
        'claude-code': { path: '/c', version: '1' },
        codex: { missing: 'gone' },
        copilot: { path: '/p', version: null },
      },
      null,
      null,
    );
    expect(lockedClis(availability)).toEqual({});
  });

  it('the resolver skips a locked default and says so', () => {
    const choice = resolveSessionCli({ picked: null, sessionsDefault: 'copilot' }, cliAvailability(null, null, SOLO));
    expect(choice).toMatchObject({
      cli: 'claude-code',
      skipped: [{ cli: 'copilot', source: 'yours', reason: 'Copilot is in Team and above' }],
    });
  });
});
