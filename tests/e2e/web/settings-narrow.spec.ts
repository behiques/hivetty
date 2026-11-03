import { expect, test, type Page } from '@playwright/test';

import { bar } from '../fixtures/places';

/**
 * Settings at phone width (HIVE-374).
 *
 * Below the overlay's two-column breakpoint the nav becomes a group list that
 * opens one pane full width, with a back control. The breakpoint is a
 * container query on the overlay, and only a browser lays one out: the unit
 * test sees which view is asked for, never which one shows.
 */

const APP_URL = '/?sim=0';

const gear = (page: Page) => bar(page).getByRole('button', { name: 'Settings', exact: true });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });
const body = (page: Page) => page.getByTestId('settings-body');

/** Nothing inside the overlay is wider than the overlay. */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.getByRole('dialog').evaluate((dialog) => {
    const wide = [dialog, ...dialog.querySelectorAll('*')].filter(
      (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'hidden',
    );
    return wide.map((el) => `${el.tagName}.${el.className}`.slice(0, 120));
  });

  expect(overflow).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(APP_URL);
  await page.waitForSelector('nav[aria-label="Places"]');
  await gear(page).click();
});

test('opens on the group list, with no pane beside it', async ({ page }) => {
  await expect(nav(page)).toBeVisible();
  await expect(nav(page).getByRole('group', { name: 'Harnesses' })).toBeVisible();
  await expect(nav(page).getByRole('group', { name: 'General' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projects', level: 2 })).toBeHidden();

  await expectNoHorizontalScroll(page);
});

test('a pane opens full width, and back returns to the list', async ({ page }) => {
  await nav(page).getByRole('button', { name: 'Appearance' }).click();

  await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible();
  await expect(nav(page)).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-view', 'pane');

  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Back to Workspace' }).click();

  await expect(nav(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeHidden();
});

test('wide, both halves show and there is no back control', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });

  await expect(nav(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projects', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Back to / })).toBeHidden();
});
