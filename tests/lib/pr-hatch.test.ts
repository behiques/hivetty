import { describe, expect, it } from 'vitest';

import { FLAP_RANK, mergedWords, sortHatchery } from '@/lib/pr-hatch';
import type { HatcheryRow, Pr } from '@/types/pull-request';

/** Local wall-clock times, so the assertions hold in any TZ the suite runs in. */
const local = (month: number, day: number, h: number, m: number) => new Date(2026, month, day, h, m).getTime();
const NOW = local(9, 3, 15, 0); // 3 Oct 2026, 15:00 local

const pr = (over: Partial<Pr> = {}): Pr => ({
  n: 1, repo: 'name', owner: 'owner', title: 't', state: 'open', findings: 0, checks: 'passing',
  url: 'https://github.com/owner/name/pull/1', branch: 'b', session: null,
  updatedAt: '2026-10-03T10:00:00Z', mergedAt: null, mine: true, ...over,
});

describe('mergedWords', () => {
  it('reads today as the time', () => {
    expect(mergedWords(new Date(local(9, 3, 11, 32)).toISOString(), NOW)).toEqual({ at: '11:32', words: 'Merged 11:32' });
  });

  it('reads yesterday with its time', () => {
    expect(mergedWords(new Date(local(9, 2, 18, 10)).toISOString(), NOW)).toEqual({ at: '18:10', words: 'Merged yesterday 18:10' });
  });

  it('reads anything older as a day and month', () => {
    expect(mergedWords(new Date(local(7, 12, 9, 5)).toISOString(), NOW)).toEqual({ at: '09:05', words: 'Merged 12 Aug' });
  });

  it('reads a missing or unreadable time as just Merged', () => {
    expect(mergedWords(null, NOW)).toEqual({ words: 'Merged' });
    expect(mergedWords('not a date', NOW)).toEqual({ words: 'Merged' });
  });
});

describe('sortHatchery', () => {
  const row = (n: number, flap: keyof typeof FLAP_RANK, over: Partial<Pr> = {}): HatcheryRow => ({
    pr: pr({ n, ...over }),
    hatch: { flap, tone: 'muted', github: '', rank: FLAP_RANK[flap], needsYou: flap === 'SUMMONS' },
  });

  it('orders open by flap, then most recently updated; merged after, newest merge first', () => {
    const rows = [
      row(1, 'LARVA'),
      row(2, 'HATCHED', { state: 'merged', mergedAt: '2026-10-03T09:00:00Z' }),
      row(3, 'SUMMONS', { updatedAt: '2026-10-03T08:00:00Z' }),
      row(4, 'MUTATING'),
      row(5, 'SUMMONS', { updatedAt: '2026-10-03T09:00:00Z' }),
      row(6, 'HATCHED', { state: 'merged', mergedAt: '2026-10-03T11:00:00Z' }),
      row(7, 'HATCHING'),
      row(8, 'INCUBATING'),
      row(9, 'COCOONING'),
      row(10, 'BURROWED'),
    ];
    expect(sortHatchery(rows).map((r) => r.pr.n)).toEqual([5, 3, 7, 4, 8, 9, 10, 1, 6, 2]);
  });

  it('does not mutate its input', () => {
    const rows = [row(1, 'LARVA'), row(2, 'SUMMONS')];
    sortHatchery(rows);
    expect(rows.map((r) => r.pr.n)).toEqual([1, 2]);
  });
});
