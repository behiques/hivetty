// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { jobEntries } from '../../shared/job-derive';
import type { LedgerEntry } from '../../shared/ledger-contract';

let seq = 0;
const e = (over: Partial<LedgerEntry> & Pick<LedgerEntry, 'from' | 'kind'>): LedgerEntry => {
  seq += 1;
  return { id: `20261112-0900${String(seq).padStart(2, '0')}-0001`, ts: Date.UTC(2026, 10, 12, 9, seq), body: '', ...over };
};
const ids = (entries: LedgerEntry[]) => entries.map((entry) => entry.id);

describe('jobEntries (Job Flow)', () => {
  it('seeds by ticket in any case and leaves other tickets out', () => {
    const ask = e({ from: 'sess-1', to: 'builder', kind: 'ask', meta: { ticket: 'hive-401' } });
    const other = e({ from: 'sess-2', to: 'builder', kind: 'ask', meta: { ticket: 'HIVE-9' } });
    expect(ids(jobEntries([ask, other], { ticket: 'HIVE-401', prs: [] }))).toEqual([ask.id]);
  });

  it('takes an answer on a job thread, and an ask a job entry threads to', () => {
    const bare = e({ from: 'shipper', to: 'acr', kind: 'ask' });
    const ask = e({ from: 'sess-1', to: 'builder', kind: 'ask', meta: { ticket: 'HIVE-401' } });
    const answer = e({ from: 'builder', to: 'sess-1', kind: 'answer', thread: ask.id });
    const reply = e({ from: 'acr', to: 'shipper', kind: 'answer', thread: bare.id, meta: { ticket: 'HIVE-401' } });
    expect(ids(jobEntries([bare, ask, answer, reply], { ticket: 'HIVE-401', prs: [] }))).toEqual([bare.id, ask.id, answer.id, reply.id]);
  });

  it('finds the ticket from a PR, and the ticket’s other entries with it', () => {
    const shipped = e({ from: 'shipper', kind: 'post', meta: { pr: 281, repo: 'Behiques/HiveTTY', ticket: 'HIVE-401' } });
    const plan = e({ from: 'sess-1', to: 'builder', kind: 'ask', meta: { ticket: 'HIVE-401' } });
    expect(ids(jobEntries([plan, shipped], { prs: [{ repo: 'behiques/hivetty', n: 281 }] }))).toEqual([shipped.id, plan.id]);
  });

  it('finds a second PR from the ticket, and that PR’s untagged entries', () => {
    const opened = e({ from: 'builder', to: 'sess-1', kind: 'answer', meta: { ticket: 'HIVE-401', pr: '284', repo: 'behiques/hivetty' } });
    const stage = e({ from: 'shipper', kind: 'post', meta: { pr: 284, repo: 'behiques/hivetty', stage: 'ci' } });
    expect(ids(jobEntries([opened, stage], { ticket: 'HIVE-401', prs: [] }))).toEqual([opened.id, stage.id]);
  });

  it('takes an ask held on one of the job’s PRs', () => {
    const held = e({ from: 'sess-1', to: 'builder', kind: 'ask', meta: { after: 'behiques/hivetty#281' } });
    expect(ids(jobEntries([held], { prs: [{ repo: 'behiques/hivetty', n: 281 }] }))).toEqual([held.id]);
  });

  it('takes a claim and a release of the job’s ticket, in any case, and no other task’s', () => {
    const claim = e({ from: 'sess-1', kind: 'claim', meta: { task: 'hive-401' } });
    const slug = e({ from: 'sess-1', kind: 'claim', meta: { task: 'goal/job-flow' } });
    const other = e({ from: 'sess-2', kind: 'claim', meta: { task: 'HIVE-9' } });
    const release = e({ from: 'sess-1', kind: 'release', meta: { task: 'HIVE-401' } });
    expect(ids(jobEntries([claim, slug, other, release], { ticket: 'HIVE-401', prs: [] }))).toEqual([claim.id, release.id]);
  });

  it('takes the ticket’s claim once a PR has named the ticket, and never a post’s task number', () => {
    const claim = e({ from: 'sess-1', kind: 'claim', meta: { task: 'HIVE-401' } });
    const progress = e({ from: 'builder', kind: 'post', meta: { task: 'HIVE-401' } });
    const shipped = e({ from: 'shipper', kind: 'post', meta: { pr: 281, repo: 'behiques/hivetty', ticket: 'HIVE-401' } });
    expect(ids(jobEntries([claim, progress, shipped], { prs: [{ repo: 'behiques/hivetty', n: 281 }] }))).toEqual([claim.id, shipped.id]);
  });

  it('answers nothing for no seeds, and id order whatever the input order', () => {
    const a = e({ from: 'sess-1', kind: 'post', meta: { ticket: 'HIVE-401' } });
    const b = e({ from: 'sess-1', kind: 'post', meta: { ticket: 'HIVE-401' } });
    expect(jobEntries([a, b], { prs: [] })).toEqual([]);
    expect(ids(jobEntries([b, a], { ticket: 'HIVE-401', prs: [] }))).toEqual([a.id, b.id]);
  });
});
