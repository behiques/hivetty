import type {
  BillingCard,
  BillingInvoice,
  BillingPayments,
  BillingSubscription,
  BillingSummary,
  OpenWebResult,
} from '@shared/account-contract';

import { isOrgId } from './orgs';

/**
 * The Account center's Plan & billing, against hivetty-cloud's `GET /api/billing`. The cloud's AccountGuard takes the
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

type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Stripe's own pages (portal, checkout, invoices): https on stripe.com or a subdomain, nothing else. */
function isStripeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'));
  } catch {
    return false;
  }
}

function cardOf(value: unknown): BillingCard | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const { brand, last4, expMonth, expYear } = value as Record<string, unknown>;
  if (!isString(brand) || !isString(last4) || typeof expMonth !== 'number' || typeof expYear !== 'number') return undefined;
  return { brand, last4, expMonth, expYear };
}

function invoiceOf(value: unknown): BillingInvoice | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, number, created, total, currency, status, pdfUrl, hostedUrl } = value as Record<string, unknown>;
  if (!isString(id) || (number !== null && !isString(number)) || !isString(created)) return undefined;
  if (typeof total !== 'number' || !isString(currency) || !isString(status)) return undefined;
  // A link the pane cannot open is no link: the row stays, without it.
  return {
    id,
    number,
    created,
    total,
    currency,
    status,
    pdfUrl: isStripeUrl(pdfUrl) ? pdfUrl : null,
    hostedUrl: isStripeUrl(hostedUrl) ? hostedUrl : null,
  };
}

/** The card and invoices, against `GET /api/billing/payments`. Any failure, an older cloud's 404 too, is `null`. */
export async function readPayments(authedFetch: AuthedFetch, orgId: unknown): Promise<BillingPayments | null> {
  if (orgId !== undefined && !isOrgId(orgId)) return null;
  const path = orgId === undefined ? '/api/billing/payments' : `/api/billing/payments?orgId=${encodeURIComponent(orgId)}`;
  let response: Response;
  try {
    response = await authedFetch(path);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null) return null;
  const { card: rawCard, invoices: rawInvoices } = body as Record<string, unknown>;
  const card = cardOf(rawCard);
  if (card === undefined || !Array.isArray(rawInvoices)) return null;
  const invoices = rawInvoices.map(invoiceOf);
  return invoices.every((invoice): invoice is BillingInvoice => invoice !== undefined) ? { card, invoices } : null;
}

/** An invoice's PDF or page, or a portal session: only Stripe's own https pages reach the browser. */
export async function openStripeLink(
  openExternal: (url: string) => Promise<void>,
  url: unknown,
): Promise<OpenWebResult> {
  if (!isStripeUrl(url)) return { error: 'That is not a Stripe billing page.' };
  try {
    await openExternal(url);
  } catch {
    return { error: "The browser didn't open." };
  }
  return { ok: true };
}

/**
 * Manage billing: a Stripe portal session for the org, opened in the browser. Anything short of one (an older cloud
 * that refuses the bearer, no customer yet, offline, a URL off stripe.com) falls back to the signed-in plan page.
 */
export async function openBillingPortal(
  deps: {
    authedFetch: AuthedFetch;
    openExternal: (url: string) => Promise<void>;
    openWeb: (path: string) => Promise<OpenWebResult>;
  },
  orgId: unknown,
): Promise<OpenWebResult> {
  if (orgId !== undefined && !isOrgId(orgId)) return { error: 'That is not one of your organizations.' };
  let url: unknown = null;
  try {
    const response = await deps.authedFetch('/api/billing/portal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(orgId === undefined ? {} : { orgId }),
    });
    if (response.ok) url = ((await response.json().catch(() => null)) as { url?: unknown } | null)?.url;
  } catch {
    // Offline: the plan page below says so in the browser's own words.
  }
  return isStripeUrl(url) ? openStripeLink(deps.openExternal, url) : deps.openWeb('/account/plan');
}
