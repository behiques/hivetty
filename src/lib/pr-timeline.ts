/**
 * The PR Timeline's pure half (HIVE-208): the time scale, the lanes and
 * "where the time went", from the timeline read, the ledger and the ship
 * track. No React and no store; every function takes its clock.
 */

import type { PrTimelineRun } from '@shared/github-contract';
import type { LedgerEntry } from '@shared/ledger-contract';

export const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * MIN);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

export interface Tick { at: number; f: number; label: string }

/** Where `t` sits between `start` and `end`, 0 to 1. */
export function fraction(t: number, start: number, end: number): number {
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** `HH:MM`, local; with the weekday once the axis spans more than a day. */
const clock = (t: number, days: boolean) => {
  const d = new Date(t);
  return `${days ? `${DAYS[d.getDay()]} ` : ''}${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Ticks on round local times, the smallest step whose labels sit `minGapPx`
 * apart (HIVE-208). Steps of an hour or more start on the first whole local
 * hour, so a long axis still opens near its start.
 */
export function ticks(start: number, end: number, widthPx: number, minGapPx = 72): Tick[] {
  const span = Math.max(end - start, MIN);
  const step = STEPS.find((s) => (s / span) * widthPx >= minGapPx) ?? DAY;
  const round = Math.min(step, HOUR);
  const offset = new Date(start).getTimezoneOffset() * MIN;
  const first = Math.ceil((start - offset) / round) * round + offset;
  const days = span > DAY;
  const out: Tick[] = [];
  for (let at = first; at <= end; at += step) out.push({ at, f: fraction(at, start, end), label: clock(at, days) });
  return out;
}

export interface CiBar {
  id: number;
  number: number;
  sha: string;
  url: string;
  from: number;
  to: number;
  state: PrTimelineRun['state'];
  failedJobs: string[];
}

/** One bar per run, start to end; a running one ends at `now`; skipped and cancelled runs are not drawn. */
export function ciBars(runs: readonly PrTimelineRun[], now: number): CiBar[] {
  return runs
    .filter((run) => run.state !== 'other')
    .map((run) => {
      const from = Date.parse(run.startedAt);
      const to = run.endedAt === null ? now : Math.max(from, Date.parse(run.endedAt));
      return { id: run.id, number: run.number, sha: run.sha, url: run.url, from, to, state: run.state, failedJobs: run.failedJobs };
    })
    .sort((a, b) => a.from - b.from);
}

export interface Hold { who: string; from: number; to: number; firstEventId: string | null }
type Span = Omit<Hold, 'firstEventId'>;

const taskIs = (entry: LedgerEntry, wanted: string) => {
  const task = entry.meta?.['task'];
  return typeof task === 'string' && task.toLowerCase() === wanted;
};

/** The shipper's own spans, claim to release or a `closed` stage post, and its asks to acr and fixer. */
function shipperSpans(events: readonly LedgerEntry[], all: readonly LedgerEntry[], wanted: string, now: number) {
  let held: number | null = null;
  const asks: Span[] = [];
  const spans: { from: number; to: number }[] = [];
  for (const entry of events) {
    if (entry.from !== 'shipper') continue;
    const ends = (entry.kind === 'release' && taskIs(entry, wanted)) || (entry.kind === 'post' && entry.meta?.['stage'] === 'closed');
    if (entry.kind === 'claim' && taskIs(entry, wanted) && held === null) held = entry.ts;
    else if (ends) {
      if (held !== null) spans.push({ from: held, to: entry.ts });
      held = null;
    } else if (entry.kind === 'ask' && (entry.to === 'acr' || entry.to === 'fixer')) {
      const answer = all.find((a) => a.kind === 'answer' && a.thread === entry.id);
      asks.push({ who: entry.to, from: entry.ts, to: answer?.ts ?? now });
    }
  }
  if (held !== null) spans.push({ from: held, to: now });
  return { asks, spans };
}

/**
 * Who held the PR, when (HIVE-208): the opener until its intake ask, the
 * shipper from claim to release or `closed`, and inside that acr or fixer from
 * each shipper ask to its answer. The shipper holds the gaps.
 */
export function holdIntervals(
  events: readonly LedgerEntry[], all: readonly LedgerEntry[], slug: string, n: number,
  opener: string | null, createdAt: number, now: number,
): Hold[] {
  const raw: Span[] = [];
  const intake = events.find((entry) => entry.kind === 'ask' && entry.to === 'shipper' && entry.meta?.['stage'] === 'intake');
  if (opener !== null) raw.push({ who: opener, from: createdAt, to: intake?.ts ?? now });

  const { asks, spans } = shipperSpans(events, all, `${slug.toLowerCase()}#${n}`, now);
  for (const span of spans) {
    let cursor = span.from;
    for (const ask of asks.filter((a) => a.from >= span.from && a.from < span.to)) {
      if (ask.from > cursor) raw.push({ who: 'shipper', from: cursor, to: ask.from });
      const to = Math.min(ask.to, span.to);
      raw.push({ who: ask.who, from: Math.max(ask.from, cursor), to });
      cursor = Math.max(cursor, to);
    }
    if (cursor < span.to) raw.push({ who: 'shipper', from: cursor, to: span.to });
  }

  const merged: Span[] = [];
  for (const hold of raw.filter((h) => h.to > h.from)) {
    const last = merged.at(-1);
    if (last !== undefined && last.who === hold.who && last.to >= hold.from) last.to = Math.max(last.to, hold.to);
    else merged.push({ ...hold });
  }
  return merged.map((hold) => {
    const own = events.find((entry) => entry.from === hold.who && entry.ts >= hold.from && entry.ts < hold.to);
    const ask = events.find((entry) => entry.kind === 'ask' && entry.to === hold.who && entry.ts === hold.from);
    return { ...hold, firstEventId: own?.id ?? ask?.id ?? null };
  });
}
