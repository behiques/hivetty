import { useEffect, useSyncExternalStore } from 'react';

import { useAccount } from '@hooks/use-account';
import { useLicence } from '@hooks/use-licence';
import { listOrgs } from '@lib/account';
import type { OrgSummary } from '@shared/orgs';

/**
 * The account's orgs (HIVE-291), one list for every consumer: `useSyncExternalStore` over a module-level cache,
 * as `use-skills.ts` argues. Fetched when the account becomes signed in, and on `refreshOrgs()` (the account
 * menu opening), at most once a minute. Main's seen-set turns a new org into a renewal (D5).
 */
export const ORGS_REFRESH_MS = 60_000;

const NONE: OrgSummary[] = [];
let cache: OrgSummary[] = NONE;
let fetchedAt: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = (): OrgSummary[] => cache;

function publish(next: OrgSummary[]): void {
  cache = next;
  for (const listener of listeners) listener();
}

/** Ask main for the orgs, unless it was asked less than a minute ago. */
export function refreshOrgs(): void {
  const now = Date.now();
  if (fetchedAt !== null && now - fetchedAt < ORGS_REFRESH_MS) return;
  fetchedAt = now;
  void listOrgs().then((orgs) => {
    if (orgs !== null) publish(orgs);
  });
}

/** Forget the list, so the next account starts fresh. Sign-out calls it; so do the tests. */
export function resetOrgs(): void {
  fetchedAt = null;
  publish(NONE);
}

export function useOrgs(): OrgSummary[] {
  const kind = useAccount()?.kind;
  useEffect(() => {
    if (kind === 'signed-in') refreshOrgs();
    else if (kind === 'signed-out') resetOrgs();
  }, [kind]);
  const orgs = useSyncExternalStore(subscribe, snapshot, snapshot);
  return kind === 'signed-in' ? orgs : NONE;
}

/** The org the lease came from: the active org everywhere, whatever was asked for. */
export function useActiveOrg(): OrgSummary | undefined {
  const orgs = useOrgs();
  const licence = useLicence();
  const org = licence?.kind === 'licensed' || licence?.kind === 'grace' ? licence.org : undefined;
  return orgs.find((candidate) => candidate.id === org);
}
