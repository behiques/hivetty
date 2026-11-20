import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobFlowView } from '@features/shared/components/job-flow-view';
import { type LedgerEntry, type LedgerJobQuery, OVERMIND } from '@shared/ledger-contract';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';

const BASE = Date.UTC(2026, 10, 12, 9, 0);
const MIN = 60_000;
const at = (m: number) => BASE + m * MIN;
let seq = 0;
const e = (m: number, over: Partial<LedgerEntry> & Pick<LedgerEntry, 'from' | 'kind'>): LedgerEntry => {
  seq += 1;
  return { id: `20261112-${String(900 + m).padStart(6, '0')}-${String(seq).padStart(4, '0')}`, ts: at(m), body: over.kind, ...over };
};

/** The job from tests/lib/job-flow.test.ts, repeated: a1 carries the ticket, the rest join by thread or by naming PR 281. */
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

const job = vi.fn();
let hive: unknown;
beforeEach(() => {
  hive = window.hive;
  (window as unknown as { hive: unknown }).hive = { ledger: { job } };
  useHiveStore.setState({ jobs: {}, ledger: [] });
  useUiStore.setState({ flowFocus: null });
});
afterEach(() => {
  (window as unknown as { hive: unknown }).hive = hive;
  job.mockReset();
  vi.useRealTimers();
});

const ticket = (key: string): LedgerJobQuery => ({ ticket: key, prs: [] });

describe('JobFlowView (Job Flow)', () => {
  it('reads the job on mount and draws its chart', async () => {
    job.mockResolvedValue({ entries: JOB, warnings: [] });
    render(<JobFlowView query={ticket('HIVE-401')} emptyText="Nothing yet." />);
    expect(job).toHaveBeenCalledWith(ticket('HIVE-401'));
    expect(await screen.findByRole('img', { name: "The job's parties over time" })).toBeTruthy();
    expect(screen.getByText('Select a handoff to see what was asked and how it closed.')).toBeTruthy();
  });

  it('shows a skeleton while the read is out', () => {
    job.mockReturnValue(new Promise(() => {}));
    render(<JobFlowView query={ticket('HIVE-401')} emptyText="Nothing yet." />);
    expect(screen.getByRole('status', { name: 'Loading the flow' })).toBeTruthy();
  });

  it('says so when nobody has written about the job', async () => {
    job.mockResolvedValue({ entries: [], warnings: [] });
    render(<JobFlowView query={ticket('HIVE-402')} emptyText="No agent or session has written about HIVE-402 yet." />);
    expect(await screen.findByText('No agent or session has written about HIVE-402 yet.')).toBeTruthy();
  });

  it('says why a read failed, and reads again on retry', async () => {
    job.mockRejectedValue(new Error('ledger job needs a ticket or a PR'));
    render(<JobFlowView query={ticket('HIVE-403')} emptyText="" />);
    expect(await screen.findByText('ledger job needs a ticket or a PR')).toBeTruthy();
    job.mockResolvedValue({ entries: JOB, warnings: [] });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('names unreadable days under the summary', async () => {
    job.mockResolvedValue({ entries: JOB, warnings: ['2026-11-01'] });
    render(<JobFlowView query={ticket('HIVE-401')} emptyText="" />);
    expect(await screen.findByText('Some of the ledger could not be read: 2026-11-01.')).toBeTruthy();
  });

  it('says the ledger could not be read, not that nothing was written, when a job comes back empty with unreadable days', async () => {
    job.mockResolvedValue({ entries: [], warnings: ['2026-11-01', '2026-11-02'] });
    render(<JobFlowView query={ticket('HIVE-401')} emptyText="No agent or session has written about HIVE-401 yet." />);
    expect(await screen.findByText('Some of the ledger could not be read: 2026-11-01, 2026-11-02.')).toBeTruthy();
    expect(screen.queryByText('No agent or session has written about HIVE-401 yet.')).toBeNull();
    job.mockResolvedValue({ entries: JOB, warnings: [] });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(job).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('img', { name: "The job's parties over time" })).toBeTruthy();
  });

  it('selects a handoff and shows its card; Show the whole job clears it', async () => {
    job.mockResolvedValue({ entries: JOB, warnings: [] });
    render(<JobFlowView query={ticket('HIVE-401')} emptyText="" />);
    fireEvent.click(await screen.findByRole('button', { name: 'a3: shipper to acr' }));
    expect(screen.getByText('Selected handoff')).toBeTruthy();
    expect(useUiStore.getState().flowFocus).toEqual({ job: 'ticket:HIVE-401', edge: a3.id });
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole job' }));
    expect(screen.queryByText('Selected handoff')).toBeNull();
  });

  it('goes to the session a selected handoff involves', async () => {
    const openEntity = vi.fn(() => true);
    useHiveStore.setState({ openEntity });
    job.mockResolvedValue({ entries: JOB, warnings: [] });
    render(<JobFlowView query={ticket('HIVE-401')} emptyText="" />);
    fireEvent.click(await screen.findByRole('button', { name: 'a1: sess-1 to builder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to sess-1' }));
    expect(openEntity).toHaveBeenCalledWith('sess-1');
  });

  it('moves now once a minute while the job is live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(at(27));
    job.mockResolvedValue({ entries: JOB.slice(0, 6), warnings: [] });
    render(<JobFlowView query={ticket('HIVE-401')} emptyText="" />);
    expect(await screen.findByText('27m')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('28m')).toBeTruthy();
  });

  it('keeps no timer for a finished job', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(at(40));
    job.mockResolvedValue({ entries: JOB, warnings: [] });
    render(<JobFlowView query={ticket('HIVE-401')} emptyText="" />);
    expect(await screen.findByText('32m')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('32m')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
