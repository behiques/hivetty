import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LedgerEntry, LedgerJobQuery } from '@shared/ledger-contract';
import { JOB_CAP, jobKey, useHiveStore, useJobEntry, useJobFlow, useLoadJob } from '@stores/hive-store';

const entry = (id: string, meta: Record<string, unknown>, over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id,
  ts: Date.UTC(2026, 10, 12, 9, Number(id.slice(-2))),
  from: 'sess-1',
  kind: 'post',
  body: '',
  meta,
  ...over,
});

const job = vi.fn();
let hive: unknown;
beforeEach(() => {
  hive = window.hive;
  (window as unknown as { hive: unknown }).hive = { ledger: { job } };
  useHiveStore.setState({ jobs: {}, ledger: [] });
});
afterEach(() => {
  (window as unknown as { hive: unknown }).hive = hive;
  job.mockReset();
});

const TICKET: LedgerJobQuery = { ticket: 'HIVE-401', prs: [] };

describe('the job slice (Job Flow)', () => {
  it('keys a ticket job by its key and a PR job by its PRs', () => {
    expect(jobKey({ ticket: 'hive-401', prs: [] })).toBe('ticket:HIVE-401');
    expect(jobKey({ prs: [{ repo: 'Behiques/HiveTTY', n: 281 }] })).toBe('pr:behiques/hivetty#281');
  });

  it('reads once, holding the history and the warnings', async () => {
    job.mockResolvedValue({ entries: [entry('20261112-090001-0001', { ticket: 'HIVE-401' })], warnings: ['2026-11-01'] });
    const { result } = renderHook(() => useLoadJob());
    await result.current(TICKET);
    expect(job).toHaveBeenCalledWith(TICKET);
    expect(useHiveStore.getState().jobs['ticket:HIVE-401']).toMatchObject({ state: 'ok', warnings: ['2026-11-01'] });
    const { result: read } = renderHook(() => useJobEntry('ticket:HIVE-401'));
    expect(read.current?.history).toHaveLength(1);
  });

  it('is loading until the read lands', async () => {
    let land: (value: unknown) => void = () => {};
    job.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const pending = useHiveStore.getState().loadJob(TICKET);
    expect(useHiveStore.getState().jobs['ticket:HIVE-401']?.state).toBe('loading');
    land({ entries: [], warnings: [] });
    await pending;
    expect(useHiveStore.getState().jobs['ticket:HIVE-401']?.state).toBe('ok');
  });

  it('says why a read failed', async () => {
    job.mockRejectedValue(new Error('ledger job needs a ticket or a PR'));
    await useHiveStore.getState().loadJob(TICKET);
    expect(useHiveStore.getState().jobs['ticket:HIVE-401']).toMatchObject({ state: 'failed', problem: 'ledger job needs a ticket or a PR' });
    job.mockRejectedValue('gone');
    await useHiveStore.getState().loadJob(TICKET);
    expect(useHiveStore.getState().jobs['ticket:HIVE-401']).toMatchObject({ state: 'failed', problem: 'gone' });
  });

  it('reads nothing with no bridge, and still answers ok so the tail can draw', async () => {
    (window as unknown as { hive: unknown }).hive = undefined;
    await useHiveStore.getState().loadJob(TICKET);
    expect(useHiveStore.getState().jobs['ticket:HIVE-401']).toMatchObject({ state: 'ok', history: [], warnings: [] });
  });

  it(`keeps at most ${JOB_CAP} jobs, the newest last`, async () => {
    job.mockResolvedValue({ entries: [], warnings: [] });
    for (let i = 0; i <= JOB_CAP; i += 1) await useHiveStore.getState().loadJob({ ticket: `HIVE-${i}`, prs: [] });
    expect(Object.keys(useHiveStore.getState().jobs)).toHaveLength(JOB_CAP);
    expect(useHiveStore.getState().jobs['ticket:HIVE-0']).toBeUndefined();
  });

  it('merges the history with the live tail, and admits only the job’s entries', async () => {
    job.mockResolvedValue({
      entries: [entry('20261112-090001-0001', { ticket: 'HIVE-401' }, { kind: 'ask', to: 'builder' })],
      warnings: [],
    });
    await useHiveStore.getState().loadJob(TICKET);
    useHiveStore.setState({
      ledger: [
        entry('20261112-090005-0002', {}, { from: 'builder', to: 'sess-1', kind: 'answer', thread: '20261112-090001-0001' }),
        entry('20261112-090006-0003', { ticket: 'HIVE-9' }),
      ],
    });
    const { result } = renderHook(() => useJobFlow(TICKET, Date.UTC(2026, 10, 12, 10)));
    expect(result.current?.edges.map((x) => x.id)).toEqual(['20261112-090001-0001', '20261112-090005-0002']);
    // No entity for either id in this store: both fall back to a session lane named by its id.
    expect(result.current?.lanes.map((l) => [l.id, l.kind, l.name])).toEqual([
      ['sess-1', 'session', 'sess-1'],
      ['builder', 'session', 'builder'],
    ]);
  });

  it('names a lane from the fleet: an agent by its id, a session by its own name', () => {
    useHiveStore.setState({
      entities: {
        builder: { id: 'builder', kind: 'agent' },
        'sess-1': { id: 'sess-1', kind: 'session', name: 'hive-401' },
        'term-1': { id: 'term-1', kind: 'terminal' },
      } as never,
      ledger: [
        entry('20261112-090001-0001', { ticket: 'HIVE-401' }, { kind: 'ask', to: 'builder' }),
        entry('20261112-090002-0002', { ticket: 'HIVE-401' }, { from: 'term-1', kind: 'post' }),
        entry('20261112-090003-0003', { ticket: 'HIVE-401' }, { from: 'overmind', kind: 'post' }),
      ],
    });
    const { result } = renderHook(() => useJobFlow(TICKET, Date.UTC(2026, 10, 12, 10)));
    expect(result.current?.lanes.map((l) => [l.id, l.kind, l.name])).toEqual([
      ['overmind', 'overmind', 'You'],
      ['sess-1', 'session', 'hive-401'],
      ['builder', 'agent', 'builder'],
      ['term-1', 'session', 'term-1'],
    ]);
  });

  it('forgets every job read on a mode switch and on reset', () => {
    const held = { 'ticket:HIVE-401': { key: 'ticket:HIVE-401', state: 'ok' as const, history: [], warnings: [] } };
    useHiveStore.setState({ jobs: held });
    useHiveStore.getState().clearModeEntities();
    expect(useHiveStore.getState().jobs).toEqual({});
    useHiveStore.setState({ jobs: held });
    useHiveStore.getState().reset();
    expect(useHiveStore.getState().jobs).toEqual({});
  });

  it('answers null before anything is known about the job', () => {
    const { result } = renderHook(() => useJobFlow(TICKET, Date.UTC(2026, 10, 12, 10)));
    expect(result.current).toBeNull();
  });
});
