/**
 * What a PR handed to the shipper is waiting on (HIVE-411), read from the log: the shipper's stage and how long
 * it has been there, the findings rounds so far, and every owed ask naming the PR with its party's refusal and
 * open cards. `null` when the log knows nothing of the PR. Pure; `refusalOf` is main's agent state.
 */
import type { PrShipStatus, PrShipWait } from '@shared/github-contract';
import { OVERMIND, type LedgerEntry } from '@shared/ledger-contract';
import { askStates, shipTrack, type AskState } from '@shared/ledger-derive';

/** `meta.pr` as a number or its string, `meta.repo` in any case: the ship skill writes a number, people a string. */
const namesPr = (entry: LedgerEntry, repo: string, n: number): boolean =>
  String(entry.meta?.['pr']) === String(n) && String(entry.meta?.['repo']).toLowerCase() === repo.toLowerCase();

type Owed = AskState & { state: PrShipWait['state']; owes: string };

const isOwed = (s: AskState): s is Owed =>
  (s.state === 'open' || s.state === 'delivered' || s.state === 'accepted') && s.owes !== undefined;

export function shipStatus(
  entries: readonly LedgerEntry[],
  repo: string,
  n: number,
  now: number,
  refusalOf: (agent: string) => string | undefined,
): PrShipStatus | null {
  const track = shipTrack(entries, repo, n, now);
  const states = askStates(entries, now);
  const owed = states.filter(isOwed).filter((s) => namesPr(s.ask, repo, n));
  if (track.visits.length === 0 && owed.length === 0) return null;

  const cardsOf = (party: string): PrShipWait['cards'] =>
    states
      .filter((s) => s.state === 'open' || s.state === 'delivered')
      .filter((s) => s.ask.to === OVERMIND && s.ask.from === party && s.ask.meta?.['kind'] === 'permission')
      .map((s) => ({ id: s.ask.ref ?? s.ask.id, ageMs: now - s.ask.ts }))
      .sort((a, b) => b.ageMs - a.ageMs);

  return {
    stage: track.current?.stage ?? null,
    // The open visit, wherever it sits: a held PR has exactly one with no end.
    since: track.held ? (track.visits.find((v) => v.to === null)?.from ?? null) : null,
    rounds: track.visits.filter((v) => v.stage === 'findings').length,
    waitingOn: owed.map((s) => {
      const refused = refusalOf(s.owes);
      return {
        ask: s.ask.ref ?? s.ask.id,
        to: s.owes,
        state: s.state,
        since: s.since,
        ...(refused === undefined ? {} : { refused }),
        cards: cardsOf(s.owes),
      };
    }),
  };
}
