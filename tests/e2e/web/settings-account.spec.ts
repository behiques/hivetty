import { expect, test, type Page } from '@playwright/test';

import { bar } from '../fixtures/places';

/**
 * The Account centre's Plan & billing tab on the browser target (HIVE-268's Plan & licence). There is no bridge
 * here, so the licence reads `null` and the tab asks to sign in, with no buttons.
 */

const APP_URL = '/?sim=0';

const gear = (page: Page) => bar(page).getByRole('button', { name: 'Settings', exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForSelector('nav[aria-label="Places"]');
  await gear(page).click();
});

test('the profile card opens the Account centre; Plan & billing asks to sign in on the browser target', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  const card = nav.getByRole('button', { name: 'Account' });
  await expect(card).toContainText('Not signed in');
  await card.click();
  await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible();
  await page.getByRole('tab', { name: 'Plan & billing' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Plan & billing' })).toContainText('Sign in to see your plan.');
});
