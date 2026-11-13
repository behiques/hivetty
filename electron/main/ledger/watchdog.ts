/**
 * The overmind's watchdog (HIVE-411): which stalled asks and runs are due a step, read from the log.
 *
 * Pure, and `now` is passed in: the scheduler's sweep calls it once a minute and applies what it returns.
 * Each step is written with `meta.watch` (the step) and `meta.watched` (the ask), from the overmind, and a
 * step whose marker is already in the log is never due again. That is the dedupe, and it survives a
 * restart because the log does, as expiry's and delivery's receipts do. It never grants, denies, answers
 * a card or kills a run.
 */
import { OVERMIND, type LedgerEntry } from '@shared/ledger-contract';
import { askStates } from '@shared/ledger-derive';

/** A session nudged this long ago, with its context never served, is nudged again. */
export const RENUDGE_AFTER_MS = 60_000;
/** After a re-nudge this long ago, still unpicked: a card for the person. */
export const CARD_AFTER_MS = 15 * 60_000;
/** A live run that has written nothing for this long is reported to its askers. */
export const QUIET_RUN_MS = 60 * 60_000;
/** How long an accepted ask's lane may stay quiet when its agent has no interval. */
export const QUIET_LANE_FALLBACK_MS = 30 * 60_000;
/** How many of its own intervals an interval agent's accepted lane may stay quiet. */
export const QUIET_LANE_INTERVALS = 3;

export type WatchStepName = 'renudge' | 'card' | 'rewake' | 'quiet';

export interface LiveRun {
  agent: string;
  run: string;
  lane: string;
  startedAt: number;
}

export interface WatchFacts {
  isAgent(id: string): boolean;
  /** How long `agent`'s accepted lane may stay quiet. */
  quietMs(agent: string): number;
  laneLive(agent: string, lane: string): boolean;
  liveRuns(): readonly LiveRun[];
}

export interface WatchStep {
  step: WatchStepName;
  /** The ask the step is about. */
  ask: LedgerEntry;
  /** Who the write goes to. */
  to: string;
  /** The silent run, for `quiet`. */
  run?: string;
}

const markKey = (step: string, watched: string, run?: string): string => `${step} ${watched} ${run ?? ''}`;

/** Every watchdog marker main wrote, by key, with when. Only the overmind's count: `meta` is a rider anyone can write. */
function marks(entries: readonly LedgerEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of entries) {
    if (entry.from !== OVERMIND) continue;
    const step = entry.meta?.['watch'];
    const watched = entry.meta?.['watched'];
    if (typeof step !== 'string' || typeof watched !== 'string') continue;
    const run = entry.meta?.['run'];
    const key = markKey(step, watched, step === 'quiet' && typeof run === 'string' ? run : undefined);
    if (!out.has(key)) out.set(key, entry.ts);
  }
  return out;
}

/** The first nudge receipt for each entry: the overmind's `meta.delivered` event. */
function receipts(entries: readonly LedgerEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.meta?.['delivered'];
    if (entry.from === OVERMIND && typeof id === 'string' && !out.has(id)) out.set(id, entry.ts);
  }
  return out;
}

export function watchSteps(entries: readonly LedgerEntry[], now: number, facts: WatchFacts): WatchStep[] {
  const states = askStates(entries, now);
  const marked = marks(entries);
  const nudged = receipts(entries);
  const out: WatchStep[] = [];

  for (const { ask, state } of states) {
    const to = ask.to;
    if (state !== 'open' || to === undefined || to === OVERMIND || facts.isAgent(to)) continue;
    const receipt = nudged.get(ask.id);
    if (receipt === undefined) continue;
    if (!marked.has(markKey('renudge', ask.id))) {
      if (now - receipt >= RENUDGE_AFTER_MS) out.push({ step: 'renudge', ask, to });
    }
  }

  return out;
}
