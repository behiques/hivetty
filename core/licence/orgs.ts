import type { OrgSummary } from '@shared/orgs';

import { stringField } from './cloud';

/**
 * The account's orgs (HIVE-291 against HIVE-288's `GET /api/orgs`). The body is checked here, at the trust
 * boundary, field by field. The switcher is a convenience, so every failure answers `[]` rather than a sentence.
 */
const stringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

function orgOf(row: unknown): OrgSummary | null {
  const id = stringField(row, 'id');
  const name = stringField(row, 'name');
  const role = stringField(row, 'role');
  if (!id || !name || !role) return null;
  const { seat, plan, status, personal } = row as Record<string, unknown>;
  if (typeof seat !== 'boolean' || typeof personal !== 'boolean') return null;
  if (!stringOrNull(plan) || !stringOrNull(status)) return null;
  return { id, name, role, seat, plan, status, personal };
}

export async function listOrgs(
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<OrgSummary[]> {
  let response: Response;
  try {
    response = await authedFetch('/api/orgs');
  } catch {
    return [];
  }
  if (!response.ok) return [];
  const body: unknown = await response.json().catch(() => null);
  const rows = (body as { orgs?: unknown } | null)?.orgs;
  if (!Array.isArray(rows)) return [];
  const orgs = rows.map(orgOf);
  return orgs.every((org): org is OrgSummary => org !== null) ? orgs : [];
}

/** `account:switch-org`'s id crosses IPC: a string of 1–64 characters, the cloud's own bound. */
export const isOrgId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64;

/**
 * D5: the org ids listed since launch or sign-in. The first list only seeds (a launch already renews); a later
 * list holding a new id calls `onNew`, the licence refresh, in case the cloud would now grant that org.
 */
export function createSeenOrgs(onNew: () => void): { note(orgs: OrgSummary[]): void; clear(): void } {
  let seen: Set<string> | null = null;
  return {
    note(orgs) {
      if (orgs.length === 0) return; // a failed list is [], and must not seed
      const before = seen;
      seen = new Set([...(before ?? []), ...orgs.map((org) => org.id)]);
      if (before !== null && orgs.some((org) => !before.has(org.id))) onNew();
    },
    clear() {
      seen = null;
    },
  };
}
