import { describe, expect, it } from 'vitest';

import { ciBars, fraction, holdIntervals, MIN, ticks } from '@lib/pr-timeline';
import type { PrTimelineRun } from '@shared/github-contract';
import type { LedgerEntry } from '@shared/ledger-contract';

const T0 = new Date(2026, 9, 3, 11, 0).getTime();

describe('fraction', () => {
  it('places a time on the axis, clamped', () => {
    expect(fraction(T0 + 95 * MIN, T0, T0 + 190 * MIN)).toBe(0.5);
    expect(fraction(T0 - MIN, T0, T0 + 10 * MIN)).toBe(0);
    expect(fraction(T0 + 20 * MIN, T0, T0 + 10 * MIN)).toBe(1);
    expect(fraction(T0, T0, T0)).toBe(0);
  });
});

describe('ticks', () => {
  it('a 10-minute PR ticks every few minutes, HH:MM, never touching', () => {
    const out = ticks(T0, T0 + 10 * MIN, 900);
    expect(out[0]).toMatchObject({ at: T0, f: 0, label: '11:00' });
    expect(out.map((t) => t.label)).toEqual(['11:00', '11:05', '11:10']);
  });
  it('the design PR (3h10m at ~900px) ticks every 30 minutes', () => {
    expect(ticks(T0, T0 + 190 * MIN, 900).map((t) => t.label)).toEqual(['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00']);
  });
  it('a 3-day PR widens the step and names the day', () => {
    const out = ticks(T0, T0 + 3 * 24 * 60 * MIN, 900);
    const gaps = out.slice(1).map((t, i) => (t.f - out[i]!.f) * 900);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(56);
    expect(out[0]?.label).toBe('Sat 11:00');
  });
});

describe('ciBars', () => {
  const run = (over: Partial<PrTimelineRun>): PrTimelineRun => ({ id: 1, number: 2198, url: 'u', sha: 'abc', workflow: 'CI',
    startedAt: new Date(T0 + 61 * MIN).toISOString(), endedAt: new Date(T0 + 72 * MIN).toISOString(), state: 'passed', failedJobs: [], ...over });
  it('draws passed, failed and running runs oldest first, the running one to now, skipped ones not at all', () => {
    const bars = ciBars([
      run({ id: 3, startedAt: new Date(T0 + 186 * MIN).toISOString(), endedAt: null, state: 'running' }),
      run({ id: 1 }),
      run({ id: 2, state: 'failed', failedJobs: ['integration'], startedAt: new Date(T0 + 141 * MIN).toISOString(), endedAt: new Date(T0 + 150 * MIN).toISOString() }),
      run({ id: 4, state: 'other' }),
    ], T0 + 190 * MIN);
    expect(bars.map((b) => [b.id, b.state, (b.to - b.from) / MIN])).toEqual([[1, 'passed', 11], [2, 'failed', 9], [3, 'running', 4]]);
    expect(bars[1]?.failedJobs).toEqual(['integration']);
  });
});

describe('holdIntervals', () => {
  const slug = 'acme/server';
  const e = (id: string, m: number, over: Partial<LedgerEntry>): LedgerEntry => ({ id, ts: T0 + m * MIN, from: 'shipper', kind: 'post', body: '', ...over });
  const intake = e('i', 4, { from: 'builder', kind: 'ask', to: 'shipper', meta: { pr: 1182, repo: slug, stage: 'intake' } });
  const claim = e('c', 4, { kind: 'claim', meta: { task: 'acme/server#1182' } });
  const toAcr = e('a1', 6, { kind: 'ask', to: 'acr', body: 'https://github.com/acme/server/pull/1182 --self' });
  const acrAnswer = e('a1r', 34, { from: 'acr', kind: 'answer', thread: 'a1', to: 'shipper' });
  const toFixer = e('f1', 34, { kind: 'ask', to: 'fixer', body: 'acme/server#1182 findings' });
  const fixerAnswer = e('f1r', 60, { from: 'fixer', kind: 'answer', thread: 'f1', to: 'shipper' });
  const toFixer2 = e('f2', 110, { kind: 'ask', to: 'fixer', body: 'acme/server#1182 findings' });
  const events = [intake, claim, toAcr, toFixer, toFixer2];
  const all = [...events, acrAnswer, fixerAnswer];

  it('the opener, then the shipper, acr and fixer while asked, the open ask to now', () => {
    const holds = holdIntervals(events, all, slug, 1182, 'builder', T0, T0 + 190 * MIN);
    expect(holds.map((h) => [h.who, (h.from - T0) / MIN, (h.to - T0) / MIN])).toEqual([
      ['builder', 0, 4], ['shipper', 4, 6], ['acr', 6, 34], ['fixer', 34, 60], ['shipper', 60, 110], ['fixer', 110, 190],
    ]);
    expect(holds.find((h) => h.who === 'acr')?.firstEventId).toBe('a1');
  });

  it('ends at the release, and is empty with no opener and no shipper', () => {
    const release = e('r', 120, { kind: 'release', meta: { task: 'acme/server#1182' } });
    const holds = holdIntervals([...events, release], [...all, release], slug, 1182, 'builder', T0, T0 + 190 * MIN);
    expect(holds.at(-1)).toMatchObject({ who: 'fixer', to: T0 + 120 * MIN });
    expect(holdIntervals([], [], slug, 1182, null, T0, T0 + 10 * MIN)).toEqual([]);
  });
});
