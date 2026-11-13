// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { shipStatus } from '../../../../electron/main/ledger/ship-status';
import type { LedgerEntry } from '../../../../electron/shared/ledger-contract';

const REPO = 'behiques/hivetty';
const none = (): undefined => undefined;

let seq = 0;
const entry = (over: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'from' | 'ts'>): LedgerEntry => {
  seq += 1;
  return { id: `20261113-000000-${String(seq).padStart(4, '0')}`, body: '', ...over };
};
const stage = (name: string, ts: number): LedgerEntry =>
  entry({ kind: 'post', from: 'shipper', ts, meta: { pr: 281, repo: REPO, stage: name } });

describe('shipStatus (HIVE-411)', () => {
  it('is null when the log knows nothing of the PR', () => {
    const other = entry({ kind: 'post', from: 'shipper', ts: 1, meta: { pr: 282, repo: REPO, stage: 'ci' } });
    expect(shipStatus([other], REPO, 281, 10, none)).toBeNull();
  });

  it("reads the shipper's stage and when it was entered", () => {
    const claim = entry({ kind: 'claim', from: 'shipper', ts: 500, meta: { task: `${REPO}#281` } });
    expect(shipStatus([claim, stage('approval', 1000)], REPO, 281, 2000, none)).toEqual({
      stage: 'approval',
      since: 1000,
      rounds: 0,
      waitingOn: [],
    });
  });

  it('counts each visit to findings as a round', () => {
    const log = [stage('findings', 10), stage('approval', 20), stage('findings', 30)];
    expect(shipStatus(log, REPO, 281, 40, none)).toMatchObject({ stage: 'findings', since: 30, rounds: 2 });
  });

  it("lists every owed ask naming the PR, with its party's refusal and open cards", () => {
    const ask = entry({ kind: 'ask', from: 'sess-0a', to: 'shipper', ts: 300, ref: 'a84', body: 'Ship PR #281', meta: { pr: 281, repo: REPO } });
    const card = entry({ kind: 'ask', from: 'shipper', to: 'overmind', ts: 500, ref: 'a85', body: 'Allow Bash?', meta: { kind: 'permission' } });
    const refusalOf = (agent: string): string | undefined => (agent === 'shipper' ? 'budget' : undefined);
    expect(shipStatus([ask, card], REPO, 281, 2000, refusalOf)).toEqual({
      stage: null,
      since: null,
      rounds: 0,
      waitingOn: [{ ask: 'a84', to: 'shipper', state: 'open', since: 300, refused: 'budget', cards: [{ id: 'a85', ageMs: 1500 }] }],
    });
  });

  it('matches an ask that names the PR number as a string', () => {
    const ask = entry({ kind: 'ask', from: 'sess-0a', to: 'shipper', ts: 300, ref: 'a90', body: 'Ship', meta: { pr: '281', repo: 'Behiques/Hivetty' } });
    expect(shipStatus([ask], REPO, 281, 400, none)?.waitingOn).toEqual([
      { ask: 'a90', to: 'shipper', state: 'open', since: 300, cards: [] },
    ]);
  });
});
