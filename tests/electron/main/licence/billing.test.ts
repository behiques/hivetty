// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { readBilling } from '../../../../electron/main/licence/billing';

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
