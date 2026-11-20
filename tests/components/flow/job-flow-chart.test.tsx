import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CHART_W, JobFlowChart } from '@components/flow/job-flow-chart';
import { buildJobFlow, HANDOFF_MIN_PX } from '@lib/job-flow';
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
const noop = () => {};

describe('JobFlowChart: the frame (Job Flow)', () => {
  it('draws one labelled track per party, with its kind', () => {
    render(<JobFlowChart flow={flow} selected={null} onSelect={noop} />);
    const lanes = screen.getAllByTestId('flow-lane');
    expect(lanes.map((lane) => lane.getAttribute('data-lane'))).toEqual([OVERMIND, 'sess-1', 'builder', 'shipper', 'acr']);
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getAllByText('agent')).toHaveLength(3);
  });

  it('labels the axis', () => {
    render(<JobFlowChart flow={flow} selected={null} onSelect={noop} />);
    expect(screen.getAllByTestId('flow-tick').length).toBeGreaterThan(1);
  });

  it('draws a break with the length it hides', () => {
    const quiet = [a1, { ...r1, ts: at(0) + 5 * 60 * MIN }];
    const gapped = buildJobFlow({ entries: quiet, party, now: at(0) })!;
    render(<JobFlowChart flow={gapped} selected={null} onSelect={noop} />);
    expect(screen.getByTestId('flow-gap').textContent).toBe('5h 00m');
  });
});

describe('JobFlowChart: a job with many breaks (Job Flow)', () => {
  it('grows wider than its frame so thirty breaks still leave the work room, and stays its usual width otherwise', () => {
    const { unmount } = render(<JobFlowChart flow={flow} selected={null} onSelect={noop} />);
    expect(screen.getByRole('img').getAttribute('width')).toBe(String(CHART_W));
    unmount();

    // A post every three hours for four days: thirty silences, each a break.
    const posts = Array.from({ length: 31 }, (_, i) => e(i * 180, { from: 'sess-1', kind: 'post' }));
    const long = buildJobFlow({ entries: posts, party, now: at(0) })!;
    expect(long.gaps).toHaveLength(30);
    render(<JobFlowChart flow={long} selected={null} onSelect={noop} />);
    const svg = screen.getByRole('img');
    const width = Number(svg.getAttribute('width'));
    expect(width).toBeGreaterThan(CHART_W);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${String(width)} ${svg.getAttribute('height') ?? ''}`);
    const breaks = screen.getAllByTestId('flow-gap').map((gap) => Number(gap.getAttribute('x')));
    expect(breaks).toHaveLength(30);
    for (let i = 1; i < breaks.length; i += 1) expect(breaks[i] ?? 0).toBeGreaterThan(breaks[i - 1] ?? 0);
    expect(breaks.at(-1) ?? 0).toBeLessThan(width);
  });
});

describe('JobFlowChart: the route (Job Flow)', () => {
  it('draws work, waiting on you and waiting each in its own tone', () => {
    const { container } = render(<JobFlowChart flow={flow} selected={null} onSelect={noop} />);
    const tones = [...container.querySelectorAll('[data-testid="flow-segment"]')].map((n) => n.getAttribute('data-tone'));
    expect(tones.filter((t) => t === 'you')).toHaveLength(1);
    expect(tones.filter((t) => t === 'work').length).toBeGreaterThan(3);
    expect(tones.filter((t) => t === 'wait').length).toBeGreaterThan(2);
  });

  it('draws one focusable handoff per edge, named by its ref, or its kind for a return', () => {
    render(<JobFlowChart flow={flow} selected={null} onSelect={noop} />);
    expect(screen.getAllByRole('button')).toHaveLength(flow.edges.length);
    expect(screen.getByRole('button', { name: 'a3: shipper to acr' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'done: shipper to sess-1' })).toBeTruthy();
    expect(screen.getByText('a3')).toBeTruthy();
  });

  it('labels the lanes with their marks, and puts a station on a finished task', () => {
    const task = e(5, { from: 'builder', kind: 'post', meta: { stage: 'build', task: 2 } });
    const withTask = buildJobFlow({ entries: [...JOB, task].sort((x, y) => x.ts - y.ts), party, now: at(32) })!;
    const { container } = render(<JobFlowChart flow={withTask} selected={null} onSelect={noop} />);
    expect(screen.getByText('self-review')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="flow-station"]')).toHaveLength(1);
  });

  it('marks now on a live job, and not on a finished one', () => {
    const live = buildJobFlow({ entries: JOB.slice(0, 6), party, now: at(27) })!;
    const { rerender } = render(<JobFlowChart flow={live} selected={null} onSelect={noop} />);
    expect(screen.getByTestId('flow-now')).toBeTruthy();
    rerender(<JobFlowChart flow={flow} selected={null} onSelect={noop} />);
    expect(screen.queryByTestId('flow-now')).toBeNull();
  });
});

describe('JobFlowChart: selection (Job Flow)', () => {
  it('calls onSelect on click, Enter and Space, and not on another key', () => {
    const onSelect = vi.fn();
    render(<JobFlowChart flow={flow} selected={null} onSelect={onSelect} />);
    const handoff = screen.getByRole('button', { name: 'a3: shipper to acr' });
    fireEvent.click(handoff);
    fireEvent.keyDown(handoff, { key: 'Enter' });
    fireEvent.keyDown(handoff, { key: ' ' });
    fireEvent.keyDown(handoff, { key: 'Tab' });
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenCalledWith(a3.id);
  });

  it('dims everything off the selected thread, and nothing with no selection', () => {
    const { container, rerender } = render(<JobFlowChart flow={flow} selected={null} onSelect={noop} />);
    expect(container.querySelectorAll('.opacity-25')).toHaveLength(0);
    rerender(<JobFlowChart flow={flow} selected={r3.id} onSelect={noop} />);
    const lit = [...container.querySelectorAll(`[data-thread="${a3.id}"]`)];
    expect(lit.length).toBeGreaterThan(2); // the ask, its return, acr's work and shipper's wait
    expect(lit.every((n) => !n.classList.contains('opacity-25'))).toBe(true);
    expect(container.querySelector(`[data-thread="${a1.id}"]`)?.classList.contains('opacity-25')).toBe(true);
  });

  it('dims nothing for a selection that names no edge', () => {
    const { container } = render(<JobFlowChart flow={flow} selected="gone" onSelect={noop} />);
    expect(container.querySelectorAll('.opacity-25')).toHaveLength(0);
  });
});

describe('JobFlowChart: crowded handoffs (Job Flow)', () => {
  const SEC = 1000;
  /** An hour of work, then a burst, then ninety quiet minutes (under a break): the shipper asks acr, acr answers a second later, and so on. */
  const first = e(0, { from: 'sess-1', to: 'shipper', kind: 'ask', ref: 'b0' });
  const burst = Array.from({ length: 6 }, (_, i) => {
    const ask = { ...e(60, { from: 'shipper', to: 'acr', kind: 'ask', ref: `b${String(i + 1)}` }), ts: at(60) + i * 2 * SEC };
    return [ask, { ...e(60, { from: 'acr', to: 'shipper', kind: 'answer', thread: ask.id }), ts: ask.ts + SEC }];
  }).flat();
  const last = e(150, { from: 'shipper', to: 'sess-1', kind: 'done', thread: first.id });
  const crowded = buildJobFlow({ entries: [first, ...burst, last], party, now: at(150) })!;
  const centres = (container: HTMLElement, selector: string, attribute: string) =>
    [...container.querySelectorAll(selector)].map((node) => Number(node.getAttribute(attribute))).sort((a, b) => a - b);

  it('keeps handoffs a second apart at least their minimum room from each other', () => {
    const { container } = render(<JobFlowChart flow={crowded} selected={null} onSelect={noop} />);
    const xs = centres(container, '[role="button"] circle', 'cx');
    expect(xs).toHaveLength(crowded.edges.length);
    for (let i = 1; i < xs.length; i += 1) expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeGreaterThanOrEqual(HANDOFF_MIN_PX - 0.001);
  });

  it('thins the axis labels where the stretched handoffs squeeze the clock', () => {
    const { container } = render(<JobFlowChart flow={crowded} selected={null} onSelect={noop} />);
    const xs = centres(container, '[data-testid="flow-tick"] line', 'x1');
    expect(xs.length).toBeGreaterThan(1);
    for (let i = 1; i < xs.length; i += 1) expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeGreaterThanOrEqual(64);
  });
});
