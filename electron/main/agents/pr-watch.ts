import type { PrRecord, PrsSnapshot } from '@shared/github-contract';
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

const FACETS = ['state', 'checks', 'reviewDecision', 'findings', 'head', 'mergeable'] as const;

/** What a wake cares about in one PR. */
export type PrFacet = Pick<PrRecord, (typeof FACETS)[number]>;

export interface PrChange {
  /** `owner/name`, as GitHub spells it. */
  repo: string;
  pr: number;
  changed: string[];
  /** The post's body: `owner/name#N changed: checks running → passing`. */
  line: string;
}

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

const shown = (value: unknown): string => (value === null ? 'none' : String(value));

/**
 * The held PRs whose facets moved since `before`. A PR with no facet in `before`
 * is a baseline, never a change; a held PR missing from `after` says nothing.
 */
export function prChanges(
  before: ReadonlyMap<string, PrFacet>,
  after: PrsSnapshot,
  held: ReadonlySet<string>,
): PrChange[] {
  const changes: PrChange[] = [];
  for (const record of after.prs) {
    const repo = `${record.owner}/${record.repo}`;
    const key = keyOf(repo, record.number);
    const was = before.get(key);
    if (!held.has(key) || was === undefined) continue;
    // UNKNOWN is GitHub still computing mergeability: no information, so never a move either way.
    const changed = FACETS.filter(
      (facet) =>
        was[facet] !== record[facet] &&
        !(facet === 'mergeable' && (was.mergeable === 'UNKNOWN' || record.mergeable === 'UNKNOWN')),
    );
    if (changed.length === 0) continue;
    const moves = changed.map((facet) => `${facet} ${shown(was[facet])} → ${shown(record[facet])}`);
    changes.push({ repo, pr: record.number, changed, line: `${repo}#${String(record.number)} changed: ${moves.join(', ')}` });
  }
  return changes;
}
