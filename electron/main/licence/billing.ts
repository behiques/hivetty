import type { BillingSubscription, BillingSummary } from '@shared/account-contract';

import { isOrgId } from './orgs';

/**
 * The Account centre's Plan & billing, against hivetty-cloud's `GET /api/billing`. The cloud's AccountGuard takes the
 * desktop's bearer for GETs, so this reads what /account/plan reads. The body is checked here, at the trust boundary;
 * anything short of a well-formed summary is `null`, which the pane reads as "show the lease".
 */
const isString = (value: unknown): value is string => typeof value === 'string';

function subscriptionOf(value: unknown): BillingSubscription | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const { plan, status, interval, seats, renewsAt, cancelAtPeriodEnd } = value as Record<string, unknown>;
  if (!isString(plan) || !isString(status) || typeof seats !== 'number') return undefined;
  if (interval !== 'month' && interval !== 'year' && interval !== null) return undefined;
  if (renewsAt !== null && !isString(renewsAt)) return undefined;
  if (typeof cancelAtPeriodEnd !== 'boolean') return undefined;
  return { plan, status, interval, seats, renewsAt, cancelAtPeriodEnd };
}

export async function readBilling(
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>,
  orgId: unknown,
): Promise<BillingSummary | null> {
  if (orgId !== undefined && !isOrgId(orgId)) return null;
  let response: Response;
  try {
    response = await authedFetch(orgId === undefined ? '/api/billing' : `/api/billing?orgId=${encodeURIComponent(orgId)}`);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { orgId: org, subscription, canManage, seated } = body as Record<string, unknown>;
  const sub = subscriptionOf(subscription);
  if (!isString(org) || sub === undefined || typeof canManage !== 'boolean' || typeof seated !== 'number') return null;
  return { orgId: org, subscription: sub, canManage, seated };
}
