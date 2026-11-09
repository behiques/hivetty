// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { openBillingPortal, openStripeLink, readBilling, readPayments } from '../../../../electron/main/licence/billing';

const SUMMARY = {
  orgId: 'org-acme',
  subscription: {
    plan: 'team',
    status: 'active',
    interval: 'month',
    seats: 10,
    renewsAt: '2026-12-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    provider: 'stripe',
  },
  canManage: true,
  seated: 6,
};
const answer = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('readBilling (the Account centre, against GET /api/billing)', () => {
  it('GETs the active org’s billing and keeps only what the pane shows', async () => {
    const fetch = answer(200, SUMMARY);
    const { provider: _provider, ...subscription } = SUMMARY.subscription;
    await expect(readBilling(fetch, 'org-acme')).resolves.toEqual({ ...SUMMARY, subscription });
    expect(fetch).toHaveBeenCalledWith('/api/billing?orgId=org-acme');
  });

  it('without an org asks for the personal org, and escapes an id it is given', async () => {
    const fetch = answer(200, { ...SUMMARY, subscription: null });
    await expect(readBilling(fetch, undefined)).resolves.toMatchObject({ subscription: null });
    expect(fetch).toHaveBeenCalledWith('/api/billing');

    await readBilling(fetch, 'a b&c');
    expect(fetch).toHaveBeenLastCalledWith('/api/billing?orgId=a%20b%26c');
  });

  it.each([
    ['billing off', 404, { error: 'not_found' }],
    ['not the org’s owner or billing member', 403, { error: 'forbidden' }],
    ['signed out', 401, { error: 'invalid_token' }],
  ])('answers null when %s', async (_label, status, body) => {
    await expect(readBilling(answer(status, body), 'org-acme')).resolves.toBeNull();
  });

  it.each([
    ['no orgId', { ...SUMMARY, orgId: 3 }],
    ['a non-numeric seat count', { ...SUMMARY, seated: '6' }],
    ['a subscription missing its seats', { ...SUMMARY, subscription: { ...SUMMARY.subscription, seats: undefined } }],
    ['an unknown interval', { ...SUMMARY, subscription: { ...SUMMARY.subscription, interval: 'week' } }],
    ['a non-string renewal', { ...SUMMARY, subscription: { ...SUMMARY.subscription, renewsAt: 5 } }],
    ['not an object', ['x']],
  ])('refuses %s at the trust boundary', async (_label, body) => {
    await expect(readBilling(answer(200, body), 'org-acme')).resolves.toBeNull();
  });

  it('answers null offline, and refuses an org id that is not one', async () => {
    await expect(readBilling(vi.fn(() => Promise.reject(new Error('offline'))), 'org-acme')).resolves.toBeNull();
    const fetch = answer(200, SUMMARY);
    await expect(readBilling(fetch, 42)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

const PAYMENTS = {
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2027 },
  invoices: [
    {
      id: 'in_1',
      number: 'A-0001',
      created: '2026-11-01T00:00:00.000Z',
      total: 1200,
      currency: 'usd',
      status: 'paid',
      pdfUrl: 'https://pay.stripe.com/invoice/1/pdf',
      hostedUrl: 'https://invoice.stripe.com/i/1',
    },
  ],
};

describe('readPayments (the card and invoices, against GET /api/billing/payments)', () => {
  it('GETs the org’s card and invoices', async () => {
    const fetch = answer(200, PAYMENTS);
    await expect(readPayments(fetch, 'org-acme')).resolves.toEqual(PAYMENTS);
    expect(fetch).toHaveBeenCalledWith('/api/billing/payments?orgId=org-acme');
    await readPayments(fetch, undefined);
    expect(fetch).toHaveBeenLastCalledWith('/api/billing/payments');
  });

  it('drops a link that is not https on stripe.com, keeping the invoice', async () => {
    const invoice = { ...PAYMENTS.invoices[0], pdfUrl: 'javascript:alert(1)', hostedUrl: 'https://evil.example/i' };
    await expect(readPayments(answer(200, { card: null, invoices: [invoice] }), undefined)).resolves.toEqual({
      card: null,
      invoices: [{ ...invoice, pdfUrl: null, hostedUrl: null }],
    });
  });

  it.each([
    ['an older cloud', 404, { message: 'Cannot GET /api/billing/payments' }],
    ['not the org’s owner or billing member', 403, { error: 'forbidden' }],
  ])('answers null for %s', async (_label, status, body) => {
    await expect(readPayments(answer(status, body), 'org-acme')).resolves.toBeNull();
  });

  it.each([
    ['a card missing its last4', { ...PAYMENTS, card: { ...PAYMENTS.card, last4: 4242 } }],
    ['invoices that are not a list', { ...PAYMENTS, invoices: {} }],
    ['an invoice with a string total', { ...PAYMENTS, invoices: [{ ...PAYMENTS.invoices[0], total: '12' }] }],
    ['not an object', null],
  ])('refuses %s at the trust boundary', async (_label, body) => {
    await expect(readPayments(answer(200, body), undefined)).resolves.toBeNull();
  });

  it('answers null offline, and refuses an org id that is not one', async () => {
    await expect(readPayments(vi.fn(() => Promise.reject(new Error('offline'))), undefined)).resolves.toBeNull();
    const fetch = answer(200, PAYMENTS);
    await expect(readPayments(fetch, 7)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('openStripeLink', () => {
  it.each(['https://invoice.stripe.com/i/1', 'https://billing.stripe.com/p/1', 'https://stripe.com/x'])(
    'opens %s',
    async (url) => {
      const openExternal = vi.fn(() => Promise.resolve());
      await expect(openStripeLink(openExternal, url)).resolves.toEqual({ ok: true });
      expect(openExternal).toHaveBeenCalledWith(url);
    },
  );

  it.each(['http://billing.stripe.com/p', 'https://stripe.com.evil.example/p', 'https://evilstripe.com/p', 'file:///etc', 42])(
    'refuses %s',
    async (url) => {
      const openExternal = vi.fn(() => Promise.resolve());
      await expect(openStripeLink(openExternal, url)).resolves.toEqual({ error: expect.any(String) as string });
      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it('says so when the browser does not open', async () => {
    const result = await openStripeLink(() => Promise.reject(new Error('no')), 'https://billing.stripe.com/p');
    expect(result).toEqual({ error: "The browser didn't open." });
  });
});

describe('openBillingPortal (Manage billing)', () => {
  const deps = (fetch: ReturnType<typeof answer>) => ({
    authedFetch: fetch,
    openExternal: vi.fn(() => Promise.resolve()),
    openWeb: vi.fn(() => Promise.resolve({ ok: true as const })),
  });

  it('POSTs for the org’s portal session and opens it, no web hand-off', async () => {
    const d = deps(answer(200, { url: 'https://billing.stripe.com/p/1' }));
    await expect(openBillingPortal(d, 'org-acme')).resolves.toEqual({ ok: true });
    expect(d.authedFetch).toHaveBeenCalledWith('/api/billing/portal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-acme' }),
    });
    expect(d.openExternal).toHaveBeenCalledWith('https://billing.stripe.com/p/1');
    expect(d.openWeb).not.toHaveBeenCalled();
  });

  it('asks for the personal org with an empty body', async () => {
    const d = deps(answer(200, { url: 'https://billing.stripe.com/p/1' }));
    await openBillingPortal(d, undefined);
    expect(d.authedFetch).toHaveBeenCalledWith('/api/billing/portal', expect.objectContaining({ body: '{}' }));
  });

  it.each([
    ['an older cloud refusing the bearer', answer(403, { error: 'invalid_request' })],
    ['no customer yet', answer(404, { error: 'no_customer' })],
    ['a url off stripe.com', answer(200, { url: 'https://evil.example/p' })],
    ['offline', vi.fn(() => Promise.reject(new Error('offline')))],
  ])('falls back to the signed-in plan page for %s', async (_label, fetch) => {
    const d = deps(fetch as ReturnType<typeof answer>);
    await expect(openBillingPortal(d, 'org-acme')).resolves.toEqual({ ok: true });
    expect(d.openExternal).not.toHaveBeenCalled();
    expect(d.openWeb).toHaveBeenCalledWith('/account/plan');
  });

  it('refuses an org id that is not one, without a call', async () => {
    const d = deps(answer(200, {}));
    await expect(openBillingPortal(d, 9)).resolves.toEqual({ error: expect.any(String) as string });
    expect(d.authedFetch).not.toHaveBeenCalled();
  });
});
