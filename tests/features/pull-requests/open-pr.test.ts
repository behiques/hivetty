import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { HatcheryRow, Pr } from '@/types/pull-request';
import { openPrRow, useOpenPr } from '@features/pull-requests/open-pr';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';

import { prRecord } from '../../support/prs';

/** Which PR the page opens on (HIVE-205, spec D14). */

const pr = (n: number, over: Partial<Pr> = {}): Pr => ({
  n, repo: 'server', owner: 'acme', title: `#${n}`, state: 'open', findings: 0, checks: 'passing',
  url: `https://github.com/acme/server/pull/${n}`, branch: `b${n}`, session: null,
  mergedAt: null, mine: true, updatedAt: '2026-10-03T08:00:00Z', ...over,
});
const row = (n: number, needsYou = false): HatcheryRow => ({
  pr: pr(n),
  hatch: { flap: needsYou ? 'SUMMONS' : 'BURROWED', tone: needsYou ? 'amber' : 'muted', github: 'Open', rank: needsYou ? 0 : 5, needsYou },
});

describe('openPrRow', () => {
  const rows = [row(871, true), row(1182), row(305)];

  it('keeps the last-opened PR while it is still a row, matching owner and repo in any case', () => {
    expect(openPrRow(rows, { owner: 'ACME', repo: 'Server', n: 1182 })?.pr.n).toBe(1182);
  });

  it('falls back to the top row — the first that needs you — when the last one left or none was opened', () => {
    expect(openPrRow(rows, { owner: 'acme', repo: 'server', n: 9 })?.pr.n).toBe(871);
    expect(openPrRow(rows, { owner: 'acme', repo: 'other', n: 1182 })?.pr.n).toBe(871);
    expect(openPrRow(rows, null)?.pr.n).toBe(871);
  });

  it('opens a searched PR that is not in the sweep, from the row the click carried', () => {
    const searched = row(7777);
    expect(openPrRow(rows, { owner: 'acme', repo: 'server', n: 7777, row: searched })).toBe(searched);
  });

  it('prefers the sweep row over the carried one when the PR is in both', () => {
    expect(openPrRow(rows, { owner: 'acme', repo: 'server', n: 1182, row: row(1182) })).toBe(rows[1]);
  });

  it('falls back to the top row when nothing needs you, and to null with no rows', () => {
    expect(openPrRow([row(1182), row(305)], null)?.pr.n).toBe(1182);
    expect(openPrRow([], { owner: 'acme', repo: 'server', n: 1182 })).toBeNull();
  });
});

describe('openPrRow, when the last PR leaves the sweep', () => {
  it('shows the row that came after it, or the top row when it was the last', () => {
    const gone = { owner: 'acme', repo: 'server', n: 1182 };
    expect(openPrRow([row(871), row(305)], gone, 1)?.pr.n).toBe(305);
    expect(openPrRow([row(871), row(305)], gone, 2)?.pr.n).toBe(871);
  });
});

describe('useOpenPr', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    useUiStore.getState().reset();
  });

  it('reads the Hatchery and the last-opened PR', () => {
    useHiveStore.getState().hydratePrs([prRecord({ number: 482 }), prRecord({ number: 483 })], 1);
    useUiStore.getState().openPrPage({ owner: 'acme', repo: 'nova-web', n: 483 });
    expect(renderHook(() => useOpenPr()).result.current?.pr.n).toBe(483);
  });

  it('is null with no PRs', () => {
    expect(renderHook(() => useOpenPr()).result.current).toBeNull();
  });
});
