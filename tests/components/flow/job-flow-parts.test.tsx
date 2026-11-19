import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { JobFlowBuckets, JobFlowEntryCard, JobFlowLegend, JobFlowSummary } from '@components/flow/job-flow-parts';
import { buildJobFlow } from '@lib/job-flow';
import { type LedgerEntry, OVERMIND } from '@shared/ledger-contract';

const BASE = Date.UTC(2026, 10, 12, 9, 0);
const MIN = 60_000;
const at = (m: number) => BASE + m * MIN;
let seq = 0;
const e = (m: number, over: Partial<LedgerEntry> & Pick<LedgerEntry, 'from' | 'kind'>): LedgerEntry => {
  seq += 1;
  return { id: `20261112-${String(900 + m).padStart(6, '0')}-${String(seq).padStart(4, '0')}`, ts: at(m), body: over.kind, ...over };
};

/** The job from tests/lib/job-flow.test.ts, repeated: tests are read alone. */
const PR = { pr: 281, repo: 'behiques/hivetty' };
const a1 = e(0, { from: 'sess-1', to: 'builder', kind: 'ask', ref: 'a1', meta: { ticket: 'HIVE-401', skill: 'plan' } });
const r1 = e(10, { from: 'builder', to: 'sess-1', kind: 'answer', thread: a1.id, meta: { ...PR } });
const a2 = e(12, { from: 'sess-1', to: 'shipper', kind: 'ask', ref: 'a2', meta: { ...PR } });
const a3 = e(14, { from: 'shipper', to: 'acr', kind: 'ask', ref: 'a3', meta: { ...PR, stage: 'self-review' } });
const r3 = e(20, { from: 'acr', to: 'shipper', kind: 'answer', thread: a3.id });
const a4 = e(25, { from: 'shipper', to: OVERMIND, kind: 'ask', ref: 'a4', meta: { ...PR, stage: 'approval' } });
const r4 = e(30, { from: OVERMIND, to: 'shipper', kind: 'answer', thread: a4.id });
const d2 = e(32, { from: 'shipper', to: 'sess-1', kind: 'done', thread: a2.id, meta: { stage: 'closed' } });
const JOB = [a1, r1, a2, a3, r3, a4, r4, d2];

const party = (id: string) => ({
  id,
  name: id === OVERMIND ? 'You' : id,
  kind: id === OVERMIND ? ('overmind' as const) : id.startsWith('sess') ? ('session' as const) : ('agent' as const),
});
const flow = buildJobFlow({ entries: JOB, party, now: at(32) })!;
const byWholeText = (text: string) => (_: string, node: Element | null) => node?.tagName === 'SPAN' && node.textContent === text;

describe('JobFlowSummary (Job Flow)', () => {
  it('summarises a live job: the stage it is on, elapsed, parties, PRs, your wait', () => {
    const live = buildJobFlow({ entries: JOB.slice(0, 6), party, now: at(27) })!;
    render(<JobFlowSummary flow={live} />);
    expect(screen.getByText('You · approval')).toBeTruthy();
    expect(screen.getByText('27m')).toBeTruthy();
    expect(screen.getByText(byWholeText('5 parties'))).toBeTruthy();
    expect(screen.getByText('#281')).toBeTruthy();
    expect(screen.getByText(byWholeText('waiting on you 2m'))).toBeTruthy();
  });

  it('shows no stage for a finished job, and how much of it was quiet', () => {
    const quiet = [a1, { ...r1, ts: at(0) + 5 * 60 * MIN }];
    const gapped = buildJobFlow({ entries: quiet, party, now: at(0) })!;
    render(<JobFlowSummary flow={gapped} />);
    expect(screen.queryByText(/·/)).toBeNull();
    expect(screen.getByText(byWholeText('5h 00m since the first entry, 5h 00m of it quiet'))).toBeTruthy();
  });
});

describe('JobFlowLegend (Job Flow)', () => {
  it('names each mark the chart draws', () => {
    render(<JobFlowLegend />);
    for (const text of ['working', 'waiting on you', 'waiting on someone else', 'handoff', 'return']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });
});

describe('JobFlowEntryCard (Job Flow)', () => {
  it('shows the selected handoff: ref, who to whom, body, riders, how it closed, and its actions', () => {
    const onClear = vi.fn();
    const edge = flow.edges.find((x) => x.id === a3.id)!;
    render(<JobFlowEntryCard edge={edge} flow={flow} onClear={onClear} />);
    expect(screen.getByText('a3')).toBeTruthy();
    expect(screen.getByText('shipper → acr')).toBeTruthy();
    expect(screen.getByText('stage: self-review')).toBeTruthy();
    expect(screen.getByText('pr: 281')).toBeTruthy();
    expect(screen.getByText(/^Answered by acr at .* · 6m$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole job' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('says how long an open ask has waited, and nothing on a return', () => {
    const live = buildJobFlow({ entries: JOB.slice(0, 6), party, now: at(27) })!;
    const open = live.edges.find((x) => x.id === a4.id)!;
    const { rerender } = render(<JobFlowEntryCard edge={open} flow={live} onClear={() => {}} />);
    expect(screen.getByText('Open · 2m so far')).toBeTruthy();
    const ret = flow.edges.find((x) => x.id === r3.id)!;
    rerender(<JobFlowEntryCard edge={ret} flow={flow} onClear={() => {}} />);
    expect(screen.queryByText(/Answered|Open/)).toBeNull();
  });

  it('offers Go to only when there is a session to go to, and calls it', () => {
    const onGoTo = vi.fn();
    const toSession = flow.edges[0]!;
    const { rerender } = render(<JobFlowEntryCard edge={toSession} flow={flow} onClear={() => {}} />);
    expect(screen.queryByRole('button', { name: /^Go to/ })).toBeNull();
    rerender(<JobFlowEntryCard edge={toSession} flow={flow} onClear={() => {}} onGoTo={onGoTo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to sess-1' }));
    expect(onGoTo).toHaveBeenCalled();
    const agentsOnly = flow.edges.find((x) => x.id === a3.id)!;
    rerender(<JobFlowEntryCard edge={agentsOnly} flow={flow} onClear={() => {}} onGoTo={onGoTo} />);
    expect(screen.queryByRole('button', { name: /^Go to/ })).toBeNull();
  });
});

describe('JobFlowBuckets (Job Flow)', () => {
  it('draws a bar per party and the sentence', () => {
    render(<JobFlowBuckets flow={flow} />);
    expect(screen.getAllByTestId('flow-bucket')).toHaveLength(flow.buckets.length);
    expect(screen.getByText(flow.sentence)).toBeTruthy();
  });
});
