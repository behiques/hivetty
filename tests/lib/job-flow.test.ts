import { describe, expect, it } from 'vitest';

import {
  buildJobFlow,
  durationText,
  flowBuckets,
  flowEdges,
  flowGaps,
  flowSentence,
  flowMarks,
  flowScale,
  flowSegments,
  flowStations,
  GAP_PX,
  HANDOFF_MIN_PX,
  partiesOf,
  subtract,
  unionOf,
} from '@lib/job-flow';
import { type LedgerEntry, OVERMIND } from '@shared/ledger-contract';

const BASE = Date.UTC(2026, 10, 12, 9, 0);
const MIN = 60_000;
const at = (m: number) => BASE + m * MIN;
let seq = 0;
const e = (m: number, over: Partial<LedgerEntry> & Pick<LedgerEntry, 'from' | 'kind'>): LedgerEntry => {
  seq += 1;
  return { id: `20261112-${String(900 + m).padStart(6, '0')}-${String(seq).padStart(4, '0')}`, ts: at(m), body: over.kind, ...over };
};

/** A small whole job: a session hands to builder, then to shipper, who asks acr and then you. */
const PR = { pr: 281, repo: 'behiques/hivetty' };
const a1 = e(0, { from: 'sess-1', to: 'builder', kind: 'ask', ref: 'a1', meta: { ticket: 'HIVE-401', skill: 'plan' } });
const r1 = e(10, { from: 'builder', to: 'sess-1', kind: 'answer', thread: a1.id, meta: { ...PR } });
const a2 = e(12, { from: 'sess-1', to: 'shipper', kind: 'ask', ref: 'a2', meta: { ...PR } });
// The ship skill names the PR on every ask it makes, which is how these join a ticket-seeded job.
const a3 = e(14, { from: 'shipper', to: 'acr', kind: 'ask', ref: 'a3', meta: { ...PR, stage: 'self-review' } });
const r3 = e(20, { from: 'acr', to: 'shipper', kind: 'answer', thread: a3.id });
const a4 = e(25, { from: 'shipper', to: OVERMIND, kind: 'ask', ref: 'a4', meta: { ...PR, stage: 'approval' } });
const r4 = e(30, { from: OVERMIND, to: 'shipper', kind: 'answer', thread: a4.id });
const d2 = e(32, { from: 'shipper', to: 'sess-1', kind: 'done', thread: a2.id, meta: { stage: 'closed' } });
const JOB = [a1, r1, a2, a3, r3, a4, r4, d2];

describe('partiesOf and flowEdges (Job Flow)', () => {
  it('pins you first, then everyone in order of first appearance, and ignores app events', () => {
    const event = e(1, { from: 'hub', kind: 'event' });
    expect(partiesOf([event, ...JOB])).toEqual([OVERMIND, 'sess-1', 'builder', 'shipper', 'acr']);
  });

  it('draws an ask as a handoff and a closing kind as a return, on the ask’s thread', () => {
    const edges = flowEdges(JOB);
    expect(edges.map((x) => [x.from, x.to, x.tone, x.thread])).toEqual([
      ['sess-1', 'builder', 'work', a1.id],
      ['builder', 'sess-1', 'return', a1.id],
      ['sess-1', 'shipper', 'work', a2.id],
      ['shipper', 'acr', 'work', a3.id],
      ['acr', 'shipper', 'return', a3.id],
      ['shipper', OVERMIND, 'you', a4.id],
      [OVERMIND, 'shipper', 'return', a4.id],
      ['shipper', 'sess-1', 'return', a2.id],
    ]);
    expect(edges[0]?.closedAt).toBe(at(10));
    expect(edges[0]?.ref).toBe('a1');
    expect(edges[0]?.entry).toBe(a1);
  });

  it('leaves an open ask without closedAt, tones a failed return as a failure, and skips posts and self-addressed entries', () => {
    const open = e(40, { from: 'sess-1', to: 'builder', kind: 'ask' });
    const failed = e(41, { from: 'fixer', to: 'shipper', kind: 'failed', thread: a3.id });
    const note = e(42, { from: 'shipper', to: 'sess-1', kind: 'post' });
    const self = e(43, { from: 'builder', to: 'builder', kind: 'ask' });
    const edges = flowEdges([open, failed, note, self]);
    expect(edges).toHaveLength(2);
    expect(edges[0]?.closedAt).toBeUndefined();
    expect(edges[1]?.tone).toBe('fail');
  });
});

const spansOf = (lane: string, tone: string, segs: ReturnType<typeof flowSegments>) =>
  segs
    .filter((s) => s.lane === lane && s.tone === tone)
    .map((s) => [(s.from - BASE) / MIN, (s.to - BASE) / MIN])
    .sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0));

describe('flowSegments (Job Flow)', () => {
  it('joins and subtracts spans', () => {
    expect(unionOf([{ from: 5, to: 9 }, { from: 0, to: 6 }, { from: 12, to: 13 }, { from: 20, to: 20 }])).toEqual([
      { from: 0, to: 9 },
      { from: 12, to: 13 },
    ]);
    expect(subtract({ from: 0, to: 10 }, [{ from: 2, to: 4 }, { from: 8, to: 12 }, { from: 20, to: 30 }])).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 8 },
    ]);
  });

  it('gives each party work, its own waits cutting it, and you the time you were asked', () => {
    const segs = flowSegments(JOB, at(32));
    expect(spansOf('sess-1', 'work', segs)).toEqual([[10, 12]]);
    expect(spansOf('sess-1', 'wait', segs)).toEqual([[0, 10], [12, 32]]);
    expect(spansOf('builder', 'work', segs)).toEqual([[0, 10]]);
    expect(spansOf('shipper', 'work', segs)).toEqual([[12, 14], [20, 25], [30, 32]]);
    expect(spansOf('shipper', 'wait', segs)).toEqual([[14, 20], [25, 30]]);
    expect(spansOf('acr', 'work', segs)).toEqual([[14, 20]]);
    expect(spansOf(OVERMIND, 'you', segs)).toEqual([[25, 30]]);
    expect(segs.find((s) => s.lane === 'acr')?.thread).toBe(a3.id);
  });

  it('queues a held ask on its receiver until the PR closes, and work there cuts the queue', () => {
    const job = e(50, { from: 'sess-1', kind: 'post', meta: { ticket: 'HIVE-401' } }); // the originator speaks first
    const held = e(51, { from: 'sess-1', to: 'builder', kind: 'ask', meta: { after: 'behiques/hivetty#281' } });
    const other = e(52, { from: 'sess-2', to: 'builder', kind: 'ask' });
    const otherDone = e(55, { from: 'builder', to: 'sess-2', kind: 'answer', thread: other.id });
    const closed = e(60, { from: 'shipper', kind: 'post', meta: { pr: 281, repo: 'behiques/hivetty', stage: 'closed' } });
    const done = e(70, { from: 'builder', to: 'sess-1', kind: 'answer', thread: held.id });
    const segs = flowSegments([job, held, other, otherDone, closed, done], at(70));
    expect(spansOf('builder', 'wait', segs)).toEqual([[51, 52], [55, 60]]);
    expect(spansOf('builder', 'work', segs)).toEqual([[52, 55], [60, 70]]);
  });

  it('starts the originator’s work at its claim, before it has asked anyone', () => {
    const claim = e(0, { from: 'sess-1', kind: 'claim', meta: { task: 'HIVE-401' } });
    const ask = e(20, { from: 'sess-1', to: 'builder', kind: 'ask', meta: { ticket: 'HIVE-401' } });
    const answer = e(30, { from: 'builder', to: 'sess-1', kind: 'answer', thread: ask.id });
    const mine = flowSegments([claim, ask, answer], at(30)).filter((segment) => segment.lane === 'sess-1');
    expect(mine.map(({ tone, from, to }) => ({ tone, from, to }))).toEqual([
      { tone: 'work', from: at(0), to: at(20) },
      { tone: 'wait', from: at(20), to: at(30) },
    ]);
  });

  it('runs an open ask to the end, and a held ask never released waits there too', () => {
    const open = e(80, { from: 'sess-1', to: 'builder', kind: 'ask' });
    const held = e(81, { from: 'sess-1', to: 'fixer', kind: 'ask', meta: { after: 'behiques/hivetty#999' } });
    const segs = flowSegments([open, held], at(90));
    expect(spansOf('builder', 'work', segs)).toEqual([[80, 90]]);
    expect(spansOf('fixer', 'wait', segs)).toEqual([[81, 90]]);
    expect(spansOf('fixer', 'work', segs)).toEqual([]);
  });
});

describe('flowMarks and flowStations (Job Flow)', () => {
  it('labels a lane at the entry that names a stage, else a skill, once per change', () => {
    const again = e(26, { from: 'shipper', kind: 'post', meta: { stage: 'approval' } });
    const marks = flowMarks([...JOB, again].sort((x, y) => x.ts - y.ts), at(32));
    expect(marks.map((m) => [m.lane, (m.at - BASE) / MIN, m.text, (m.until - BASE) / MIN])).toEqual([
      ['sess-1', 0, 'plan', 32],
      ['shipper', 14, 'self-review', 25],
      ['shipper', 25, 'approval', 32],
      ['shipper', 32, 'closed', 32],
    ]);
  });

  it('prefers the stage to the skill, ignores app events, and cuts a long label', () => {
    const both = e(1, { from: 'builder', kind: 'post', meta: { stage: 'build', skill: 'execute' } });
    const event = e(2, { from: 'hub', kind: 'event', meta: { stage: 'run.started' } });
    const long = e(3, { from: 'acr', kind: 'post', meta: { skill: 'x'.repeat(80) } });
    const marks = flowMarks([both, event, long], at(3));
    expect(marks.map((m) => m.text)).toEqual(['build', 'x'.repeat(32)]);
  });

  it('puts a station where a post names a finished task', () => {
    const task = e(5, { from: 'builder', kind: 'post', meta: { ticket: 'HIVE-401', stage: 'build', task: 3 } });
    const claim = e(6, { from: 'builder', kind: 'claim', meta: { task: 'HIVE-401' } });
    expect(flowStations([...JOB, task, claim])).toEqual([{ lane: 'builder', at: at(5), task: 3 }]);
  });
});

describe('flowGaps and flowScale (Job Flow)', () => {
  const HOUR = 60 * MIN;

  it('finds silences of two hours or more, the last one running to now, and ignores app events', () => {
    const quiet = [
      e(0, { from: 'sess-1', kind: 'post' }),
      e(60, { from: 'hub', kind: 'event' }),
      e(150, { from: 'sess-1', kind: 'post' }),
      e(200, { from: 'sess-1', kind: 'post' }),
    ];
    expect(flowGaps(quiet, at(200) + 3 * HOUR)).toEqual([
      { from: at(0), to: at(150) },
      { from: at(200), to: at(200) + 3 * HOUR },
    ]);
    expect(flowGaps(quiet.slice(2), at(200) + HOUR)).toEqual([]);
  });

  it('spends the width on the visible time, and a fixed break on each gap', () => {
    const { x, spans } = flowScale(0, 10 * HOUR, [{ from: 2 * HOUR, to: 9 * HOUR }], 300 + GAP_PX);
    expect(x(0)).toBe(0);
    expect(x(2 * HOUR)).toBe(200);
    expect(x(9 * HOUR)).toBe(240);
    expect(x(10 * HOUR)).toBe(340);
    expect(x(5 * HOUR)).toBe(240); // inside a gap: the far side of its break
    expect(x(11 * HOUR)).toBe(340); // past the end: the end
    expect(spans.map((s) => [s.x, s.w])).toEqual([
      [0, 200],
      [240, 100],
    ]);
  });

  it('spans the whole width with no gaps', () => {
    const { x, spans } = flowScale(0, 4 * HOUR, [], 400);
    expect(x(HOUR)).toBe(100);
    expect(spans).toEqual([{ from: 0, to: 4 * HOUR, x: 0, w: 400 }]);
  });

  it('gives two handoffs a second apart their minimum room, and takes it from the rest of the axis', () => {
    const { x, spans } = flowScale(0, 4 * HOUR, [], 400, [HOUR, HOUR + 1000]);
    expect(x(HOUR + 1000) - x(HOUR)).toBeCloseTo(HANDOFF_MIN_PX, 6);
    const k = (400 - HANDOFF_MIN_PX) / (4 * HOUR - 1000);
    expect(x(HOUR)).toBeCloseTo(HOUR * k, 6);
    expect(x(HOUR + 500) - x(HOUR)).toBeCloseTo(HANDOFF_MIN_PX / 2, 6); // linear inside the stretched piece
    expect(x(4 * HOUR)).toBeCloseTo(400, 6);
    expect(spans).toEqual([{ from: 0, to: 4 * HOUR, x: 0, w: 400 }]);
  });

  it('leaves handoffs that already have room where the clock puts them, and repeated times count once', () => {
    const { x } = flowScale(0, 4 * HOUR, [], 400, [2 * HOUR, HOUR, HOUR]);
    expect(x(HOUR)).toBe(100);
    expect(x(2 * HOUR)).toBe(200);
    expect(x(3 * HOUR)).toBe(300);
  });

  it('stretches only between two handoffs, never from the edge of the axis to the first one', () => {
    const { x } = flowScale(0, 4 * HOUR, [], 400, [1000]);
    expect(x(1000)).toBeCloseTo(1000 * (400 / (4 * HOUR)), 6);
  });

  it('caps the stretching at seventy percent of the axis, so a burst never takes it all', () => {
    const burst = Array.from({ length: 101 }, (_, i) => HOUR + i * 1000);
    const { x } = flowScale(0, 4 * HOUR, [], 400, burst);
    expect(x(HOUR + 100_000) - x(HOUR)).toBeCloseTo(280, 6);
    expect(x(HOUR + 1000) - x(HOUR)).toBeCloseTo(2.8, 6);
    expect(x(4 * HOUR)).toBeCloseTo(400, 6);
  });

  it('stretches on each side of a break, and keeps the break where the spans meet', () => {
    const gaps = [{ from: 2 * HOUR, to: 9 * HOUR }];
    const { x, spans } = flowScale(0, 10 * HOUR, gaps, 300 + GAP_PX, [HOUR, HOUR + 1000, 9 * HOUR, 9 * HOUR + 1000]);
    expect(x(HOUR + 1000) - x(HOUR)).toBeCloseTo(HANDOFF_MIN_PX, 6);
    expect(x(9 * HOUR + 1000) - x(9 * HOUR)).toBeCloseTo(HANDOFF_MIN_PX, 6);
    expect(x(9 * HOUR) - x(2 * HOUR)).toBeCloseTo(GAP_PX, 6);
    expect(x(5 * HOUR)).toBeCloseTo(x(9 * HOUR), 6);
    expect(x(10 * HOUR)).toBeCloseTo(300 + GAP_PX, 6);
    expect((spans[0]?.w ?? 0) + (spans[1]?.w ?? 0)).toBeCloseTo(300, 6);
  });

  it('draws a job that begins and ends in the same instant at the start of the axis', () => {
    const { x, spans } = flowScale(5, 5, [], 400, [5]);
    expect(x(5)).toBe(0);
    expect(spans).toEqual([{ from: 5, to: 5, x: 0, w: 0 }]);
  });
});

describe('buildJobFlow (Job Flow)', () => {
  const party = (id: string) => ({
    id,
    name: id === OVERMIND ? 'You' : id,
    kind: id === OVERMIND ? ('overmind' as const) : id.startsWith('sess') ? ('session' as const) : ('agent' as const),
  });

  it('sums each party’s work, and your waiting, outside the gaps', () => {
    const buckets = flowBuckets(flowSegments(JOB, at(32)), []);
    expect(buckets.map((b) => [b.party, b.ms / MIN, b.tone])).toEqual([
      ['builder', 10, 'work'],
      ['shipper', 9, 'work'],
      ['acr', 6, 'work'],
      [OVERMIND, 5, 'you'],
      ['sess-1', 2, 'work'],
    ]);
    const gapped = flowBuckets(flowSegments(JOB, at(32)), [{ from: at(0), to: at(5) }]);
    expect(gapped.find((b) => b.party === 'builder')?.ms).toBe(5 * MIN);
    expect(gapped[0]?.party).toBe('shipper'); // re-sorted: builder lost half its time to the gap
    expect(durationText(95 * MIN)).toBe('1h 35m');
    expect(durationText(5 * MIN)).toBe('5m');
    expect(flowSentence(buckets, (id) => party(id).name)).toBe('builder took the most time: 10m. You were waited on for 5m.');
    expect(flowSentence(buckets.filter((b) => b.tone === 'work'), (id) => id)).toBe('builder took the most time: 10m.');
    expect(flowSentence(buckets.filter((b) => b.tone === 'you'), (id) => id)).toBe('You were waited on for 5m.');
    expect(flowSentence([], (id) => id)).toBe('');
  });

  it('builds a finished job ending on its last entry, with no now', () => {
    const flow = buildJobFlow({ entries: JOB, party, now: at(500) });
    expect(flow?.live).toBe(false);
    expect(flow?.start).toBe(at(0));
    expect(flow?.end).toBe(at(32));
    expect(flow?.now).toBeUndefined();
    expect(flow?.lanes.map((l) => l.name)).toEqual(['You', 'sess-1', 'builder', 'shipper', 'acr']);
    expect(flow?.prs).toEqual(['#281']);
    expect(flow?.sentence).toBe('builder took the most time: 10m. You were waited on for 5m.');
  });

  it('runs a live job to now and names the stage it is on', () => {
    const live = JOB.slice(0, 6); // a4 is still open: shipper waits on you
    const flow = buildJobFlow({ entries: live, party, now: at(27) });
    expect(flow?.live).toBe(true);
    expect(flow?.end).toBe(at(27));
    expect(flow?.now).toEqual({ lane: OVERMIND, label: 'You · approval' });
  });

  it('names a working agent by its own lane when nothing labels it', () => {
    const open = e(100, { from: 'sess-9', to: 'builder', kind: 'ask' });
    const flow = buildJobFlow({ entries: [open], party, now: at(110) });
    expect(flow?.now).toEqual({ lane: 'builder', label: 'builder' });
  });

  it('answers null for a job with nothing said', () => {
    expect(buildJobFlow({ entries: [], party, now: at(0) })).toBeNull();
    expect(buildJobFlow({ entries: [e(0, { from: 'hub', kind: 'event' })], party, now: at(0) })).toBeNull();
  });
});
