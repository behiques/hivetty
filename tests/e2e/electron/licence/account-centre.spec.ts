import { expect, test } from '@playwright/test';

import { signedIn } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('the avatar menu opens the Account centre; Plan & billing shows the cloud’s seats and renewal', async ({}, testInfo) => {
  stub.controls.setBilling({
    orgId: 'org-ada',
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
  });
  const { app, page } = await signedIn({ stub, testInfo });
  try {
    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Account centre' }).click();

    await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav.getByRole('button', { name: /^Account, / })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('tabpanel', { name: 'Profile & devices' })).toContainText('Test Mac');

    await page.getByRole('tab', { name: 'Plan & billing' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Plan & billing' });
    await expect(panel.getByText('6 of 10 in use')).toBeVisible();
    await expect(panel.getByText('Renews on')).toBeVisible();
    await expect(panel.getByRole('meter', { name: 'Seats in use' })).toHaveAttribute('aria-valuenow', '6');
    expect(stub.calls.some((call) => call.method === 'GET' && call.path === '/api/billing')).toBe(true);
  } finally {
    await app.close();
  }
});

test('with billing off the Plan & billing tab is the lease alone', async ({}, testInfo) => {
  const { app, page } = await signedIn({ stub, testInfo });
  try {
    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Account centre' }).click();
    await page.getByRole('tab', { name: 'Plan & billing' }).click();

    const panel = page.getByRole('tabpanel', { name: 'Plan & billing' });
    await expect(panel.getByText('Works offline until')).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Subscription' })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
