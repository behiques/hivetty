import type { LedgerEntry } from '@shared/ledger-contract';
import { askStates, claims } from '@shared/ledger-derive';

/**
 * Wake the shipper when a PR it holds moves on GitHub (HIVE-412).
 *
 * Every sweep, whoever started it, is diffed against the last one for the PRs
 * the shipper holds; each move becomes one overmind post with `meta.repo`, which
 * `laneFor` routes to that repository's lane. Main's own 60 s tick sweeps only
 * while something is held, so `gh` never runs for nothing.
 */

export const PR_WATCH_AGENT = 'shipper';

/** `owner/name#N`, the task the shipper claims at intake; a `… findings` claim does not match. */
const PR_TASK = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/;

const keyOf = (repo: string, pr: number): string => `${repo}#${String(pr)}`.toLowerCase();

/** The `owner/name#N` keys `agent` holds, lower-cased: its open PR claims and the asks it accepted. */
export function heldPrs(agent: string, entries: readonly LedgerEntry[], now: number): Set<string> {
  const held = new Set<string>();
  for (const [task, holder] of Object.entries(claims(entries))) {
    if (holder === agent && PR_TASK.test(task)) held.add(task.toLowerCase());
  }
  for (const { ask, state } of askStates(entries, now)) {
    if (state !== 'accepted' || ask.to !== agent) continue;
    const repo = ask.meta?.['repo'];
    const pr = ask.meta?.['pr'];
    if (typeof repo !== 'string' || typeof pr !== 'number' || pr <= 0) continue;
    if (PR_TASK.test(`${repo}#${String(pr)}`)) held.add(keyOf(repo, pr));
  }
  return held;
}
