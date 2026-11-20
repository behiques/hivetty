/**
 * One job's entries (Job Flow, 2026-11-12).
 *
 * A job is a ticket, its PRs, and every thread that touched them. Seeded by a
 * ticket key, PRs, or both, and grown to a fixed point: an entry joins when it
 * names a job ticket or PR, claims or releases a job ticket (`meta.task`, the
 * key `ledger_claim` writes), sits on a job thread, is the ask a job entry
 * threads to, or is held on a job PR; a ticket or PR an entry names joins the
 * seeds. Here rather than in main because main reads with it and the renderer
 * admits live entries with it: one definition of "this job".
 */

import type { LedgerEntry, LedgerJobQuery } from './ledger-contract';
import { afterTarget, namesPr, taskOf, wholeNumberOf } from './ledger-derive';

type JobPr = LedgerJobQuery['prs'][number];

const prKey = (pr: JobPr): string => `${pr.repo.toLowerCase()}#${String(pr.n)}`;

const ticketOf = (entry: LedgerEntry): string | undefined => {
  const ticket = entry.meta?.['ticket'];
  return typeof ticket === 'string' && ticket !== '' ? ticket.toUpperCase() : undefined;
};

/** A claim or release names what it holds in `meta.task`; a post's `meta.task` is a plan's task number, not a key. */
const heldOf = (entry: LedgerEntry): string | undefined =>
  entry.kind === 'claim' || entry.kind === 'release' ? taskOf(entry)?.toUpperCase() : undefined;

const prOf = (entry: LedgerEntry): JobPr | undefined => {
  const n = wholeNumberOf(entry.meta?.['pr']);
  const repo = entry.meta?.['repo'];
  return n !== undefined && n > 0 && typeof repo === 'string' && repo.includes('/') ? { repo, n } : undefined;
};

export function jobEntries(log: readonly LedgerEntry[], seeds: LedgerJobQuery): LedgerEntry[] {
  const tickets = new Set<string>();
  if (seeds.ticket !== undefined && seeds.ticket !== '') tickets.add(seeds.ticket.toUpperCase());
  const prs = new Map<string, JobPr>(seeds.prs.map((pr) => [prKey(pr), pr]));
  if (tickets.size === 0 && prs.size === 0) return [];

  const ids = new Set<string>();
  const threads = new Set<string>();
  const belongs = (entry: LedgerEntry): boolean => {
    const ticket = ticketOf(entry);
    if (ticket !== undefined && tickets.has(ticket)) return true;
    const held = heldOf(entry);
    if (held !== undefined && tickets.has(held)) return true;
    for (const pr of prs.values()) if (namesPr(entry.meta, pr.repo, pr.n)) return true;
    if (entry.thread !== undefined && ids.has(entry.thread)) return true;
    if (entry.kind === 'ask' && threads.has(entry.id)) return true;
    const after = afterTarget(entry);
    return after !== undefined && prs.has(prKey({ repo: after.repo, n: after.pr }));
  };

  for (let grew = true; grew; ) {
    grew = false;
    for (const entry of log) {
      if (ids.has(entry.id) || !belongs(entry)) continue;
      ids.add(entry.id);
      if (entry.thread !== undefined) threads.add(entry.thread);
      const ticket = ticketOf(entry);
      if (ticket !== undefined) tickets.add(ticket);
      const pr = prOf(entry);
      if (pr !== undefined) prs.set(prKey(pr), pr);
      grew = true;
    }
  }
  return log.filter((entry) => ids.has(entry.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
