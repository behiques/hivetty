import { expect, test, type Page } from '@playwright/test';

import { bar } from '../fixtures/places';

/**
 * Settings › Account › Plan & licence on the browser target (HIVE-268). There is no bridge here, so the
 * licence reads `null` and the pane asks to sign in, with no buttons.
 */

const APP_URL = '/?sim=0';

const gear = (page: Page) => bar(page).getByRole('button', { name: 'Settings', exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForSelector('nav[aria-label="Places"]');
  await gear(page).click();
});

test('Settings › Account › Plan & licence asks to sign in on the browser target (HIVE-268)', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(nav.getByRole('group', { name: 'Account' })).toBeVisible();
  await nav.getByRole('button', { name: 'Plan & licence' }).click();
  await expect(page.getByRole('heading', { name: 'Plan & licence', level: 2 })).toBeVisible();
  await expect(page.getByText('Sign in to see your plan.')).toBeVisible();
});
