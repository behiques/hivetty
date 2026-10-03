import { expect, test, type Page } from '@playwright/test';

/**
 * Round two in both themes on the web target (HIVE-210). The web target has no
 * projects, so Home is the first-run page and the comb lives in the electron
 * spec (home-comb.spec.ts). Seeded before the first frame, as round-two.spec.ts is.
 */
const GROUND = { dark: 'rgb(16, 21, 42)', light: 'rgb(253, 253, 251)' } as const;
const PANEL = { dark: 'rgb(20, 26, 51)', light: 'rgb(255, 255, 255)' } as const;

const bar = (page: Page) => page.getByRole('navigation', { name: 'Places' });
const bg = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((mode) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(
          'hive.appearance',
          JSON.stringify({ version: 3, state: { layout: 'round-two', theme: mode } }),
        );
      }, theme);
      await page.goto('/?sim=0');
      await expect(bar(page)).toBeVisible();
    });

    test('Home: the first-run page on the ground', async ({ page }, testInfo) => {
      await expect(page.getByText('An empty hive')).toBeVisible();
      await expect.poll(() => bg(page, 'body')).toBe(GROUND[theme]);
      await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`) });
    });

    for (const place of ['Sessions', 'Work', 'Agents'] as const) {
      test(`${place}: ground and list panel`, async ({ page }, testInfo) => {
        await bar(page).getByRole('button', { name: place, exact: true }).click();
        const list = page.getByRole('region', { name: `${place} list` });
        await expect(list).toBeVisible();
        if (place === 'Sessions') {
          await expect(page.getByRole('heading', { level: 1, name: 'Overmind' })).toBeVisible();
        }
        await expect.poll(() => bg(page, 'body')).toBe(GROUND[theme]);
        await expect
          .poll(() => list.evaluate((el) => getComputedStyle(el).backgroundColor))
          .toBe(PANEL[theme]);
        await page.screenshot({
          path: testInfo.outputPath(`${place.toLowerCase()}-${theme}.png`),
        });
      });
    }
  });
}
