import { OVERMIND, type LedgerPostRequest } from '@shared/ledger-contract';

/**
 * The receipt for a PR a session opened (its hooks saw `gh pr create` print it).
 *
 * The overmind writes it, never the session: the renderer reads `meta.prOpened`
 * as ownership only from the overmind (`prClaimOf`), since any party can append
 * an `event`. Broadcast, and nothing in `notify.ts` raises on it.
 */
export function prOpenedEntry(entityId: string, pr: { slug: string; number: number }): LedgerPostRequest {
  return {
    from: OVERMIND,
    kind: 'event',
    body: `${entityId} opened ${pr.slug}#${String(pr.number)}`,
    meta: { prOpened: entityId, pr: pr.number, repo: pr.slug },
  };
}
