import { expect, test, type Page } from '@playwright/test';

/**
 * Round two's frame in a real browser (HIVE-195). Seeded before the first
 * frame, because the store reads `localStorage` synchronously on boot.
 */
const bar = (page: Page) => page.getByRole('navigation', { name: 'Places' });
const place = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true });
const panel = (page: Page) => page.getByRole('region', { name: / list$/ });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'hive.appearance',
      JSON.stringify({ version: 3, state: { layout: 'round-two' } }),
    );
  });
  await page.goto('/?sim=0');
});

test('opens on Home with no list panel', async ({ page }) => {
  await expect(bar(page)).toBeVisible();
  await expect(place(page, 'Home')).toHaveAttribute('aria-current', 'page');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
});

test('each place opens its panel, and the active icon closes it', async ({ page }) => {
  for (const [name, label] of [
    ['Sessions', 'Sessions list'],
    ['Work', 'Work list'],
    ['Agents', 'Agents list'],
    ['PRs', 'PRs list'],
  ] as const) {
    await place(page, name).click();
    await expect(page.getByRole('region', { name: label })).toBeVisible();
    await expect(place(page, name)).toHaveAttribute('aria-current', 'page');
  }

  await place(page, 'PRs').click();
  await expect(panel(page)).toHaveCount(0);
  await place(page, 'PRs').click();
  await expect(page.getByRole('region', { name: 'PRs list' })).toBeVisible();
});

test('the rail chord toggles the panel', async ({ page }) => {
  await place(page, 'Work').click();
  await expect(page.getByRole('region', { name: 'Work list' })).toBeVisible();

  // The app reads the platform off the browser, not the OS (`src/lib/platform.ts`),
  // and the web project emulates Desktop Chrome, so ask the page the same question.
  const mac = await page.evaluate(() => {
    const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
    if (data?.platform) return data.platform.toLowerCase().startsWith('mac');
    return /mac/i.test(navigator.platform || navigator.userAgent);
  });
  const chord = mac ? 'Meta+b' : 'Control+Shift+b';
  await page.keyboard.press(chord);
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press(chord);
  await expect(page.getByRole('region', { name: 'Work list' })).toBeVisible();
});

test('Settings opens from the bar, and Classic comes back from it', async ({ page }) => {
  await bar(page).getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Appearance' })
    .click();

  await page
    .getByRole('radiogroup', { name: 'Layout' })
    .getByRole('radio', { name: 'Classic' })
    .click();

  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Projects, work, and agents' }),
  ).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Activity' })).toBeVisible();
});
