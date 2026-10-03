import { formatDuration } from '@/lib/format-duration';

import type { WorkflowRun } from '@shared/github-contract';

/**
 * The Checks tab's pure math (HIVE-206): job states, runs folded into pushes,
 * time captions, log line tones, and the job graph's layout. No React; the
 * store's selectors and the components both read it.
 */

export type JobState = 'passed' | 'failed' | 'running' | 'waiting' | 'skipped';
export type PushState = 'passed' | 'failed' | 'running';

/** One push: every workflow run of one head sha. `startedAt` is its earliest run. */
export interface Push { sha: string; number: number; state: PushState; runs: WorkflowRun[]; startedAt: string }

export function jobState(status: string, conclusion: string | null): JobState {
  if (status === 'in_progress') return 'running';
  if (status !== 'completed') return 'waiting';
  if (conclusion === 'success') return 'passed';
  if (conclusion === 'skipped' || conclusion === 'neutral') return 'skipped';
  return 'failed';
}

const RANK: Record<JobState, number> = { skipped: 0, passed: 1, waiting: 2, running: 3, failed: 4 };

export const worst = (states: readonly JobState[]): JobState =>
  states.reduce<JobState>((acc, state) => (RANK[state] > RANK[acc] ? state : acc), 'skipped');

/** Runs (newest first, as `gh run list` gives them) folded by head sha: the last `max` pushes, oldest first (D1). */
export function foldPushes(runs: readonly WorkflowRun[], max = 8): Push[] {
  const bySha = new Map<string, WorkflowRun[]>();
  for (const one of runs) bySha.set(one.headSha, [...(bySha.get(one.headSha) ?? []), one]);
  return [...bySha]
    .slice(0, max)
    .map(([sha, group]): Push => {
      const state = worst(group.map((r) => jobState(r.status, r.conclusion)));
      const failing = group.find((r) => jobState(r.status, r.conclusion) === 'failed');
      return {
        sha,
        number: (failing ?? group[0])?.number ?? 0,
        state: state === 'failed' ? 'failed' : state === 'running' || state === 'waiting' ? 'running' : 'passed',
        runs: group,
        startedAt: group.map((r) => r.createdAt).sort()[0] ?? '',
      };
    })
    .reverse();
}

/** "38s", "failed · 3m 10s", "running · 2m 14s", "waits", "skipped". */
export function timeText(state: JobState, startedAt: string | null, completedAt: string | null, now: number): string {
  if (state === 'waiting') return 'waits';
  if (state === 'skipped') return 'skipped';
  const start = startedAt === null ? Number.NaN : Date.parse(startedAt);
  const end = completedAt === null ? now : Date.parse(completedAt);
  const took = Number.isNaN(start) || Number.isNaN(end) ? '' : formatDuration(end - start);
  if (state === 'passed') return took;
  const word = state === 'failed' ? 'failed' : 'running';
  return took === '' ? word : `${word} · ${took}`;
}

export type LogTone = 'muted' | 'fail' | 'plain';

/* A copy of main's `log-cut.ts` marker: `src/` cannot import main. Change both. */
const FAILURE = /✕|✗|\bFAIL\b|\bError\b|##\[error\]/;
const PASS = /^\s*(✓|√)/;
const SUMMARY = /^\s*(Tests?|Test Files|Test Suites):/;
const SOURCE_MARK = /^\s*>\s*\d+\s*\|/;

/** A log line's tone: passing lines and the summary muted, the failure and its marked source line red. */
export function classifyLogLine(line: string): LogTone {
  if (PASS.test(line) || SUMMARY.test(line)) return 'muted';
  if (FAILURE.test(line) || SOURCE_MARK.test(line)) return 'fail';
  return 'plain';
}
