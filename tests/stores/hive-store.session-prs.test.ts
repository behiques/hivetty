import { describe, expect, it } from 'vitest';

import { prClaimOf, upsertSessionPr } from '@stores/hive-store';
import type { LedgerEntry } from '@shared/ledger-contract';
import { SESSION_PRS_MAX, type SessionPrRecord } from '@shared/session-history-contract';

/**
 * A session's PRs as a list it owns (the sess-19 bug): one session can open
 * several, and a branch is not a session, so two sessions in one checkout must
 * never share a PR by sharing its branch.
 */

const pr = (number: number, extra: Partial<SessionPrRecord> = {}): SessionPrRecord => ({
  number,
  repo: 'hivetty-cloud',
  url: `https://github.com/behiques/hivetty-cloud/pull/${String(number)}`,
  ...extra,
});

const entry = (fields: Partial<LedgerEntry>): LedgerEntry => ({
  id: '20261113-150000-0001',
  ts: 0,
  from: 'sess-15',
  kind: 'ask',
  body: '',
  ...fields,
});

describe('upsertSessionPr', () => {
  it('appends a PR the list does not hold', () => {
    expect(upsertSessionPr(undefined, pr(45))).toEqual([pr(45)]);
    expect(upsertSessionPr([pr(45)], pr(46))).toEqual([pr(45), pr(46)]);
  });

  it('answers undefined for a PR it already holds, matching the url case-insensitively', () => {
    expect(upsertSessionPr([pr(45)], { ...pr(45), url: pr(45).url.toUpperCase() })).toBeUndefined();
    expect(upsertSessionPr([pr(45, { owned: true })], pr(45))).toBeUndefined();
    expect(upsertSessionPr([pr(45, { owned: true })], pr(45, { owned: true }))).toBeUndefined();
  });

  it('upgrades a branch guess to owned in place', () => {
    expect(upsertSessionPr([pr(44), pr(45), pr(46)], pr(45, { owned: true }))).toEqual([
      pr(44),
      pr(45, { owned: true }),
      pr(46),
    ]);
  });

  it('keeps the newest SESSION_PRS_MAX', () => {
    const full = Array.from({ length: SESSION_PRS_MAX }, (_, i) => pr(i + 1));
    const next = upsertSessionPr(full, pr(999));
    expect(next).toHaveLength(SESSION_PRS_MAX);
    expect(next?.[0]).toEqual(pr(2));
    expect(next?.at(-1)).toEqual(pr(999));
  });
});

describe('prClaimOf', () => {
  it("reads a session's ask to the shipper as the session owning that PR", () => {
    expect(
      prClaimOf(entry({ to: 'shipper', meta: { pr: 45, repo: 'behiques/hivetty-cloud' } })),
    ).toEqual({ session: 'sess-15', pr: pr(45, { owned: true }) });
  });

  it("reads main's pr-opened event as the session it names owning that PR", () => {
    expect(
      prClaimOf(
        entry({ from: 'overmind', kind: 'event', meta: { prOpened: 'sess-19', pr: 46, repo: 'behiques/hivetty-cloud' } }),
      ),
    ).toEqual({ session: 'sess-19', pr: pr(46, { owned: true }) });
  });

  it('accepts a PR number written as a string, as the ledger readers do', () => {
    expect(
      prClaimOf(entry({ to: 'shipper', meta: { pr: '45', repo: 'behiques/hivetty-cloud' } }))?.pr.number,
    ).toBe(45);
  });

  it.each([
    ['a pr-opened event a session wrote itself', entry({ kind: 'event', meta: { prOpened: 'sess-15', pr: 45, repo: 'o/r' } })],
    ['an ask to an agent that is not the shipper', entry({ to: 'fixer', meta: { pr: 45, repo: 'o/r' } })],
    ["the shipper's own ask to a session", entry({ from: 'shipper', to: 'sess-15', meta: { pr: 45, repo: 'o/r' } })],
    ['a post to the shipper', entry({ kind: 'post', to: 'shipper', meta: { pr: 45, repo: 'o/r' } })],
    ['a repo without its owner', entry({ to: 'shipper', meta: { pr: 45, repo: 'hivetty-cloud' } })],
    ['a repo that is a path', entry({ to: 'shipper', meta: { pr: 45, repo: 'o/r/../x' } })],
    ['no PR number', entry({ to: 'shipper', meta: { repo: 'o/r' } })],
    ['a fractional PR number', entry({ to: 'shipper', meta: { pr: 4.5, repo: 'o/r' } })],
    ['no meta', entry({ to: 'shipper' })],
  ])('ignores %s', (_label, value) => {
    expect(prClaimOf(value)).toBeNull();
  });
});
