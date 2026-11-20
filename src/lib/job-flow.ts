/**
 * The Flow tab's pure half (Job Flow, 2026-11-12): one job's lanes, segments,
 * handoffs, quiet gaps and where the time went, from its ledger entries. No
 * React and no store; every function takes its clock. The same shape as
 * `pr-timeline.ts`, whose `closedAt` it shares.
 */

import { closedAt } from '@/lib/pr-timeline';

import { type LedgerEntry, type LedgerKind, OVERMIND } from '@shared/ledger-contract';
import { afterTarget, CLOSING_KINDS, releasesAfter, STAGE_TEXT_MAX, wholeNumberOf } from '@shared/ledger-derive';

export type PartyKind = 'overmind' | 'session' | 'agent';
export interface Party { id: string; name: string; kind: PartyKind }

export type EdgeTone = 'work' | 'you' | 'return' | 'fail';
export interface FlowEdge {
  id: string;
  ref?: string;
  kind: LedgerKind;
  from: string;
  to: string;
  at: number;
  tone: EdgeTone;
  /** The ask this edge opens or closes: what a selection lights. */
  thread: string;
  /** When an ask closed; absent while it waits, and on a return. */
  closedAt?: number;
  entry: LedgerEntry;
}

/** Every party that spoke or was spoken to, you first, then in order of first appearance. App events are not a party's work. */
export function partiesOf(entries: readonly LedgerEntry[]): string[] {
  const seen: string[] = [];
  const add = (id: string | undefined) => {
    if (id !== undefined && id !== '' && !seen.includes(id)) seen.push(id);
  };
  for (const entry of entries) {
    if (entry.kind === 'event') continue;
    add(entry.from);
    add(entry.to);
  }
  return seen.includes(OVERMIND) ? [OVERMIND, ...seen.filter((id) => id !== OVERMIND)] : seen;
}

/** An ask is a handoff; an answer, done or failed addressed back is a return. */
export function flowEdges(entries: readonly LedgerEntry[]): FlowEdge[] {
  const edges: FlowEdge[] = [];
  for (const entry of entries) {
    const to = entry.to;
    if (to === undefined || to === entry.from) continue;
    if (entry.kind === 'ask') {
      const closed = closedAt(entry, entries);
      edges.push({
        id: entry.id,
        ...(entry.ref === undefined ? {} : { ref: entry.ref }),
        kind: entry.kind,
        from: entry.from,
        to,
        at: entry.ts,
        tone: to === OVERMIND ? 'you' : 'work',
        thread: entry.id,
        ...(closed === undefined ? {} : { closedAt: closed }),
        entry,
      });
    } else if (CLOSING_KINDS.has(entry.kind)) {
      edges.push({
        id: entry.id,
        kind: entry.kind,
        from: entry.from,
        to,
        at: entry.ts,
        tone: entry.kind === 'failed' ? 'fail' : 'return',
        thread: entry.thread ?? entry.id,
        entry,
      });
    }
  }
  return edges;
}

export interface Span { from: number; to: number }
export type SegmentTone = 'work' | 'you' | 'wait';
export interface FlowSegment extends Span { lane: string; tone: SegmentTone; thread?: string }

/** The spans merged where they touch or overlap, in time order. Empty spans drop. */
export function unionOf(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of [...spans].filter((s) => s.to > s.from).sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last !== undefined && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else out.push({ from: span.from, to: span.to });
  }
  return out;
}

/** What is left of `span` once every hole is cut out of it. */
export function subtract(span: Span, holes: readonly Span[]): Span[] {
  let parts: Span[] = [{ from: span.from, to: span.to }];
  for (const hole of holes) {
    parts = parts.flatMap((part) => {
      if (hole.to <= part.from || hole.from >= part.to) return [part];
      const kept: Span[] = [];
      if (hole.from > part.from) kept.push({ from: part.from, to: hole.from });
      if (hole.to < part.to) kept.push({ from: hole.to, to: part.to });
      return kept;
    });
  }
  return parts;
}

interface RawSegment extends FlowSegment {
  /** The lane's own party asked and waits: this cuts its work. A held ask queued at a receiver does not. */
  own?: boolean;
}

const strip = ({ own: _own, ...segment }: RawSegment): FlowSegment => segment;

/**
 * Who was working, waiting on you, or waiting, and when.
 *
 * An ask gives its receiver work from the ask (or the release of the PR it is
 * held on, when that comes after the ask and before its close) to its close,
 * and its asker a wait for the same window; an ask to
 * you is your amber span. The originator, who asked nobody for the job, works
 * from its first word to its last. Then, per lane: a party's own waits cut its
 * work, and its work cuts a held ask's queue. Open windows run to `end`.
 */
export function flowSegments(entries: readonly LedgerEntry[], end: number): FlowSegment[] {
  const spoken = entries.filter((entry) => entry.kind !== 'event');
  const raw: RawSegment[] = [];

  for (const ask of spoken) {
    if (ask.kind !== 'ask' || ask.to === undefined || ask.to === ask.from) continue;
    const closed = closedAt(ask, entries) ?? end;
    const target = afterTarget(ask);
    // A PR released before the ask holds nothing, and a hold never outlasts the ask's own close.
    const released = target === undefined ? ask.ts : (entries.find((entry) => releasesAfter(entry, target))?.ts ?? end);
    const starts = Math.min(closed, Math.max(ask.ts, released));
    if (ask.to === OVERMIND) {
      raw.push({ lane: OVERMIND, from: ask.ts, to: closed, tone: 'you', thread: ask.id });
    } else {
      if (starts > ask.ts) raw.push({ lane: ask.to, from: ask.ts, to: starts, tone: 'wait', thread: ask.id });
      raw.push({ lane: ask.to, from: starts, to: closed, tone: 'work', thread: ask.id });
    }
    if (ask.from !== OVERMIND) raw.push({ lane: ask.from, from: ask.ts, to: closed, tone: 'wait', thread: ask.id, own: true });
  }

  const first = spoken[0];
  if (first !== undefined && first.from !== OVERMIND) {
    const last = spoken.filter((entry) => entry.from === first.from).at(-1) ?? first;
    raw.push({ lane: first.from, from: first.ts, to: last.ts, tone: 'work' });
  }

  const out: FlowSegment[] = [];
  for (const lane of new Set(raw.map((segment) => segment.lane))) {
    const mine = raw.filter((segment) => segment.lane === lane);
    const ownWaits = unionOf(mine.filter((segment) => segment.own === true));
    const work = mine
      .filter((segment) => segment.tone === 'work')
      .flatMap((segment) => subtract(segment, ownWaits).map((part) => ({ ...strip(segment), ...part })));
    const workSpans = unionOf(work);
    const waits = mine
      .filter((segment) => segment.tone === 'wait')
      .flatMap((segment) =>
        subtract(segment, segment.own === true ? [] : workSpans).map((part) => ({ ...strip(segment), ...part })),
      );
    out.push(...mine.filter((segment) => segment.tone === 'you').map(strip), ...work, ...waits);
  }
  return out.filter((segment) => segment.to > segment.from).sort((a, b) => a.from - b.from);
}

export interface FlowMark { lane: string; at: number; text: string; until: number }

const markText = (entry: LedgerEntry): string | undefined => {
  const stage = entry.meta?.['stage'];
  if (typeof stage === 'string' && stage !== '') return stage.slice(0, STAGE_TEXT_MAX);
  const skill = entry.meta?.['skill'];
  return typeof skill === 'string' && skill !== '' ? skill.slice(0, STAGE_TEXT_MAX) : undefined;
};

/**
 * A lane's labels: `meta.stage` first (the more specific), else `meta.skill`,
 * drawn where they were written. `until` is the lane's next label, or `end`:
 * the room the chart may use.
 */
export function flowMarks(entries: readonly LedgerEntry[], end: number): FlowMark[] {
  const marks: Omit<FlowMark, 'until'>[] = [];
  const last = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === 'event') continue;
    const text = markText(entry);
    if (text === undefined || last.get(entry.from) === text) continue;
    last.set(entry.from, text);
    marks.push({ lane: entry.from, at: entry.ts, text });
  }
  return marks.map((mark, i) => ({ ...mark, until: marks.slice(i + 1).find((next) => next.lane === mark.lane)?.at ?? end }));
}

export interface FlowStation { lane: string; at: number; task: number }

/** A builder-style progress post: one station per finished task. */
export function flowStations(entries: readonly LedgerEntry[]): FlowStation[] {
  return entries.flatMap((entry) => {
    const task = wholeNumberOf(entry.meta?.['task']);
    return entry.kind === 'post' && task !== undefined ? [{ lane: entry.from, at: entry.ts, task }] : [];
  });
}

/** Silence this long collapses to a break (spec: quiet over two hours). */
export const GAP_MIN_MS = 2 * 60 * 60_000;
/** Each break's width on the axis, whatever it hides. */
export const GAP_PX = 40;

export type FlowGap = Span;

/** Where the ledger fell silent: two consecutive entries, or the last and `end`, at least GAP_MIN_MS apart. */
export function flowGaps(entries: readonly LedgerEntry[], end: number): FlowGap[] {
  const times = [...entries.filter((entry) => entry.kind !== 'event').map((entry) => entry.ts), end].sort((a, b) => a - b);
  const gaps: FlowGap[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const from = times[i - 1] ?? 0;
    const to = times[i] ?? 0;
    if (to - from >= GAP_MIN_MS) gaps.push({ from, to });
  }
  return gaps;
}

export interface FlowSpan extends Span { x: number; w: number }

/**
 * The least room two consecutive handoffs get on the axis: a handoff's curve
 * is 14px wide and an ask's ref is written beside it.
 */
export const HANDOFF_MIN_PX = 36;
/** The most of the axis the stretching may take, so a burst of handoffs never leaves the work no room. */
const STRETCH_SHARE = 0.7;
/** The least of the asked width the time itself keeps. Breaks that would take more make the axis longer instead. */
const VISIBLE_MIN_SHARE = 0.5;

/** One straight run of the axis: between two handoffs, or from one to the edge of its span. */
interface Piece extends Span { x: number; w: number; k: number; tight: boolean }

/**
 * Time to px, with each gap squeezed to GAP_PX. A time inside a gap sits at the far side of its break.
 *
 * `anchors` are the handoffs' times. Two that fall closer than HANDOFF_MIN_PX
 * are moved that far apart, and the room comes from every other stretch in
 * proportion: an ask and its answer a second later would otherwise be drawn on
 * top of each other. So the axis is the clock between handoffs, and not across
 * them; the ticks are placed through `x`, and stay true.
 *
 * `width` is how long the axis came out: `widthPx`, or more when the breaks
 * alone would have left the time under half of it (a job quiet overnight for
 * weeks). The caller draws that wide and scrolls.
 */
export function flowScale(
  start: number,
  end: number,
  gaps: readonly FlowGap[],
  widthPx: number,
  anchors: readonly number[] = [],
): { x: (t: number) => number; spans: FlowSpan[]; width: number } {
  const windows: Span[] = [];
  let cursor = start;
  for (const gap of gaps) {
    windows.push({ from: cursor, to: gap.from });
    cursor = gap.to;
  }
  windows.push({ from: cursor, to: end });

  const marks = [...new Set(anchors)].sort((a, b) => a - b);
  const pieces = windows.map((win): Piece[] => {
    const inside = marks.filter((t) => t >= win.from && t <= win.to);
    const cuts = [...new Set([win.from, ...inside, win.to])];
    return cuts.slice(1).map((to, i) => {
      const from = cuts[i] ?? win.from;
      return { from, to, x: 0, w: 0, k: 0, tight: inside.includes(from) && inside.includes(to) };
    });
  });

  // Fill from the bottom: a piece between two handoffs that the clock would draw under the floor takes the floor, and the rest share what is left.
  const all = pieces.flat();
  const visible = Math.max(widthPx - gaps.length * GAP_PX, widthPx * VISIBLE_MIN_SHARE);
  const floor = Math.min(HANDOFF_MIN_PX, (visible * STRETCH_SHARE) / Math.max(all.filter((piece) => piece.tight).length, 1));
  const floored = new Set<Piece>();
  let k = 0;
  for (;;) {
    const free = all.filter((piece) => !floored.has(piece));
    k = (visible - floored.size * floor) / Math.max(free.reduce((sum, piece) => sum + piece.to - piece.from, 0), 1);
    const under = free.filter((piece) => piece.tight && (piece.to - piece.from) * k < floor);
    if (under.length === 0) break;
    for (const piece of under) floored.add(piece);
  }

  const spans: FlowSpan[] = [];
  let left = 0;
  for (const [i, win] of windows.entries()) {
    const x = left;
    for (const piece of pieces[i] ?? []) {
      piece.k = floored.has(piece) ? floor / (piece.to - piece.from) : k;
      piece.x = left;
      piece.w = (piece.to - piece.from) * piece.k;
      left += piece.w;
    }
    spans.push({ ...win, x, w: left - x });
    left += GAP_PX;
  }
  const right = left - GAP_PX;

  const x = (t: number): number => {
    for (const [i, span] of spans.entries()) {
      if (t > span.to) continue;
      if (t <= span.from) return span.x;
      for (const piece of pieces[i] ?? []) if (t <= piece.to) return piece.x + (t - piece.from) * piece.k;
    }
    return right;
  };
  return { x, spans, width: Math.max(widthPx, right) };
}

export interface FlowBucket { party: string; ms: number; tone: 'work' | 'you' }

/** Each party's working time (your waiting time for you), outside the gaps, largest first. */
export function flowBuckets(segments: readonly FlowSegment[], gaps: readonly FlowGap[]): FlowBucket[] {
  const by = new Map<string, { tone: 'work' | 'you'; spans: Span[] }>();
  for (const segment of segments) {
    if (segment.tone === 'wait') continue;
    const held = by.get(segment.lane) ?? { tone: segment.tone, spans: [] };
    held.spans.push(segment);
    by.set(segment.lane, held);
  }
  return [...by.entries()]
    .map(([party, held]) => ({
      party,
      tone: held.tone,
      ms: unionOf(held.spans)
        .flatMap((span) => subtract(span, gaps))
        .reduce((sum, span) => sum + span.to - span.from, 0),
    }))
    .filter((bucket) => bucket.ms > 0)
    .sort((a, b) => b.ms - a.ms);
}

/** `1h 35m`, or `5m` under the hour. */
export const durationText = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
};

/** One line under the bars, in the PR Timeline's voice. */
export function flowSentence(buckets: readonly FlowBucket[], nameOf: (id: string) => string): string {
  const top = buckets.find((bucket) => bucket.tone === 'work');
  const you = buckets.find((bucket) => bucket.tone === 'you');
  const waited = you === undefined ? '' : `You were waited on for ${durationText(you.ms)}.`;
  if (top === undefined) return waited;
  const first = `${nameOf(top.party)} took the most time: ${durationText(top.ms)}.`;
  return waited === '' ? first : `${first} ${waited}`;
}

export interface FlowNow { lane: string; label: string }

export interface JobFlow {
  start: number;
  end: number;
  live: boolean;
  lanes: Party[];
  segments: FlowSegment[];
  edges: FlowEdge[];
  marks: FlowMark[];
  stations: FlowStation[];
  gaps: FlowGap[];
  now?: FlowNow;
  buckets: FlowBucket[];
  sentence: string;
  /** `#281`, each PR the job's entries name, in first-named order. */
  prs: string[];
}

/**
 * The Flow tab's model: `null` until anyone has said anything about the job.
 * Live while any ask waits, and then it runs to `now`; finished, it ends on
 * its last entry.
 */
export function buildJobFlow(input: {
  entries: readonly LedgerEntry[];
  party: (id: string) => Party;
  now: number;
}): JobFlow | null {
  const { entries, party, now } = input;
  const spoken = entries.filter((entry) => entry.kind !== 'event');
  const first = spoken[0];
  const last = spoken.at(-1);
  if (first === undefined || last === undefined) return null;

  const edges = flowEdges(entries);
  const live = edges.some((edge) => edge.kind === 'ask' && edge.closedAt === undefined);
  const end = live ? Math.max(now, last.ts) : last.ts;
  const segments = flowSegments(entries, end);
  const marks = flowMarks(entries, end);
  const gaps = flowGaps(entries, end);
  const lanes = partiesOf(entries).map(party);
  const buckets = flowBuckets(segments, gaps);
  const nameOf = (id: string) => lanes.find((lane) => lane.id === id)?.name ?? id;

  // The live stage: the newest open work or wait-on-you, labelled by its own lane's mark or by the mark of whoever asked it.
  let current: FlowNow | undefined;
  if (live) {
    const active = segments
      .filter((segment) => segment.to === end && segment.tone !== 'wait')
      .sort((a, b) => b.from - a.from)[0];
    if (active !== undefined) {
      const askers = new Set(edges.filter((edge) => edge.thread === active.thread).map((edge) => edge.from));
      const mark = marks.filter((m) => m.at <= end && (m.lane === active.lane || askers.has(m.lane))).at(-1);
      const name = nameOf(active.lane);
      current = { lane: active.lane, label: mark === undefined ? name : `${name} · ${mark.text}` };
    }
  }

  const prs = [
    ...new Set(
      spoken.flatMap((entry) => {
        const n = wholeNumberOf(entry.meta?.['pr']);
        return n === undefined ? [] : [`#${String(n)}`];
      }),
    ),
  ];

  return {
    start: first.ts,
    end,
    live,
    lanes,
    segments,
    edges,
    marks,
    stations: flowStations(entries),
    gaps,
    ...(current === undefined ? {} : { now: current }),
    buckets,
    sentence: flowSentence(buckets, nameOf),
    prs,
  };
}
