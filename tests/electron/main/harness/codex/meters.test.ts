import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { codexContextPct, foldCodexMeters } from '../../../../../electron/main/harness/codex/meters';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../../../fixtures/codex', name), 'utf8').split('\n');
const tokenCount = (rateLimits: unknown, info: unknown = null) =>
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info, rate_limits: rateLimits } });
const plusLimits = {
  primary: { used_percent: 18.0, window_minutes: 300, resets_at: 1793306416 },
  secondary: { used_percent: 3.0, window_minutes: 10080, resets_at: 1793800556 },
  credits: { has_credits: false, unlimited: false, balance: '0' },
};

describe('foldCodexMeters (HIVE-334)', () => {
  it('folds the pinned interactive and exec records', () => {
    expect(foldCodexMeters(fixture('rollout-0.165.0.jsonl'))).toMatchSnapshot();
    expect(foldCodexMeters(fixture('rollout-exec-0.165.0.jsonl'))).toMatchSnapshot();
  });

  it('reads model and effort from turn_context, the later line winning', () => {
    const ctx = (model: string, effort?: string | null) =>
      JSON.stringify({ type: 'turn_context', payload: { model, ...(effort === undefined ? {} : { effort }) } });
    expect(foldCodexMeters([ctx('a', 'low'), ctx('b', 'high')])).toEqual({ model: 'b', effort: 'high' });
    // Absent or null effort is Codex's default: left out, so the picker's stays (D7's rule for effort).
    expect(foldCodexMeters([ctx('a', null)])).toEqual({ model: 'a' });
    expect(foldCodexMeters([ctx('a')])).toEqual({ model: 'a' });
  });

  it('maps windows by length, never position (D6)', () => {
    expect(foldCodexMeters([tokenCount(plusLimits)])).toEqual({
      fiveHourPct: 18,
      fiveHourResetsAt: 1793306416,
      sevenDayPct: 3,
      sevenDayResetsAt: 1793800556,
      creditsBalance: null,
      creditsUnlimited: null,
    });
    // Pro: no five-hour limit, the week in `primary`.
    const pro = { primary: plusLimits.secondary, secondary: null, credits: null };
    expect(foldCodexMeters([tokenCount(pro)])).toEqual({ sevenDayPct: 3, sevenDayResetsAt: 1793800556 });
  });

  it('shows no gauge for the free plan’s 30-day window (D6, D7)', () => {
    expect(foldCodexMeters(fixture('token-count-free-0.164.0.jsonl'))).not.toHaveProperty('fiveHourPct');
    expect(foldCodexMeters(fixture('token-count-free-0.164.0.jsonl'))).not.toHaveProperty('sevenDayPct');
  });

  it('leaves limits and context out when Codex reports none (D7)', () => {
    expect(foldCodexMeters([tokenCount(null)])).toEqual({});
  });

  it('reads context with Codex’s own formula', () => {
    const info = { last_token_usage: { total_tokens: 17398 }, model_context_window: 475000 };
    expect(foldCodexMeters([tokenCount(null, info)])).toEqual({
      contextWindow: 475000,
      contextPct: codexContextPct(17398, 475000),
    });
  });

  it('reads credits, clearing both fields with null when the plan has none (D4, D5, HIVE-381)', () => {
    const withCredits = (credits: unknown) => foldCodexMeters([tokenCount({ ...plusLimits, credits })]);
    expect(withCredits({ has_credits: false, unlimited: false, balance: '0' })).toMatchObject({
      creditsBalance: null,
      creditsUnlimited: null,
    });
    expect(withCredits({ has_credits: true, unlimited: false, balance: '1234.5' })).toMatchObject({
      creditsBalance: '1234.5',
      creditsUnlimited: false,
    });
    expect(withCredits({ has_credits: false, unlimited: true, balance: null })).toMatchObject({
      creditsBalance: null,
      creditsUnlimited: true,
    });
  });

  it('clears an earlier balance when the recorded rollout says the credits are spent (HIVE-381)', () => {
    const balance = tokenCount({ ...plusLimits, credits: { has_credits: true, unlimited: false, balance: '5' } });
    expect(foldCodexMeters([balance, ...fixture('rollout-0.165.0.jsonl')])).toMatchObject({
      creditsBalance: null,
      creditsUnlimited: null,
    });
  });

  it('moves between unlimited, spent and a balance, the later line winning (HIVE-381)', () => {
    const credits = (value: unknown) => tokenCount({ ...plusLimits, credits: value });
    const unlimited = credits({ has_credits: false, unlimited: true, balance: null });
    const spent = credits({ has_credits: false, unlimited: false, balance: '0' });
    const five = credits({ has_credits: true, unlimited: false, balance: '5' });
    expect(foldCodexMeters([unlimited, spent])).toMatchObject({ creditsBalance: null, creditsUnlimited: null });
    expect(foldCodexMeters([five, unlimited])).toMatchObject({ creditsBalance: null, creditsUnlimited: true });
    expect(foldCodexMeters([unlimited, five])).toMatchObject({ creditsBalance: '5', creditsUnlimited: false });
  });

  it('leaves credits out when a reading carries none: absence is not a spent balance (HIVE-381)', () => {
    expect(foldCodexMeters([tokenCount(null)])).not.toHaveProperty('creditsBalance');
    expect(foldCodexMeters([tokenCount({ ...plusLimits, credits: null })])).not.toHaveProperty('creditsBalance');
    const { credits: _omitted, ...noCredits } = plusLimits;
    expect(foldCodexMeters([tokenCount(noCredits)])).not.toHaveProperty('creditsUnlimited');
  });

  it('lets a later token_count win, and skips any other window length', () => {
    const info = (tokens: number) => ({ last_token_usage: { total_tokens: tokens }, model_context_window: 112_000 });
    const hour = { primary: { used_percent: 9, window_minutes: 60, resets_at: 1 }, secondary: null, credits: null };
    expect(foldCodexMeters([tokenCount(plusLimits, info(12_000)), tokenCount(hour, info(62_000))])).toEqual({
      contextWindow: 112_000,
      contextPct: 50,
      fiveHourPct: 18,
      fiveHourResetsAt: 1793306416,
      sevenDayPct: 3,
      sevenDayResetsAt: 1793800556,
      creditsBalance: null,
      creditsUnlimited: null,
    });
  });

  it('skips lines that are not JSON objects or not its kinds', () => {
    expect(foldCodexMeters(['', 'not json', '[]', '{"type":"response_item","payload":{}}'])).toEqual({});
  });
});

describe('codexContextPct (HIVE-334)', () => {
  it('counts nothing below the baseline', () => {
    expect(codexContextPct(5_000, 475_000)).toBe(0);
  });
  it('is full at the window', () => {
    expect(codexContextPct(475_000, 475_000)).toBe(100);
  });
  it('is full for a window no bigger than the baseline', () => {
    expect(codexContextPct(1, 12_000)).toBe(100);
  });
  it('rounds as Codex does', () => {
    // effective 463000, used 5398 → remaining 98.83% → 99 left → 1 used
    expect(codexContextPct(17_398, 475_000)).toBe(1);
  });
});
