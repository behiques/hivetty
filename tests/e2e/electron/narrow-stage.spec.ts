import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { launchHive, resizeTo, writeProjectConfig } from './fixtures/hive-app';

/**
 * HIVE-223: a stage the rails cannot crush. Electron only, because only a real
 * window crosses 1,200px and only a real session draws the session panel.
 */
const PROJECT = 'nova-web';
const REAL_DIRECTORY = join(import.meta.dirname, '../../..');
const STAGE_MIN = 520;
const LIST = 'section[aria-label="Sessions list"]';
const SESSION = 'aside[aria-label="Session panel"]';

const width = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().width);
const valueNow = (page: Page, name: string) => page.getByRole('slider', { name }).getAttribute('aria-valuenow');

test('saved wide rails yield to the stage floor at 1,200px, and come back at 1,440px', async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  writeProjectConfig(configPath, { id: PROJECT, path: REAL_DIRECTORY });
  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('nav[aria-label="Places"]');
    // Saved at their maxima, as a person who widened both on a big screen would have them.
    await page.evaluate(() => {
      const raw = localStorage.getItem('hive.appearance');
      const saved =
        raw === null
          ? { state: {}, version: 4 }
          : (JSON.parse(raw) as { state: Record<string, unknown>; version: number });
      saved.state = { ...saved.state, listPanelWidth: 400, sessionPanelWidth: 480, sessionPanelOpen: true };
      localStorage.setItem('hive.appearance', JSON.stringify(saved));
    });
    await page.reload();
    await page.waitForSelector('nav[aria-label="Places"]');
    // Both rails draw side by side only from 1,200px.
    await resizeTo(app, page, 1440);
    // A session started from the Sessions place keeps its list beside the stage, as session-panel.spec does.
    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Sessions', exact: true }).click();
    await page.locator(LIST).getByRole('button', { name: new RegExp(`^${PROJECT}`) }).click();
    await page.getByRole('main').getByRole('button', { name: `New session in ${PROJECT}`, exact: true }).click();
    await expect(page.locator('[data-terminal-id^="sess-"]').last()).toBeVisible();
    await expect(page.locator(LIST)).toBeVisible();
    await expect(page.locator(SESSION)).toBeVisible();

    await expect.poll(() => width(page, 'main')).toBeGreaterThanOrEqual(STAGE_MIN - 1);
    const wideList = await width(page, LIST);
    const wideSession = await width(page, SESSION);
    const wideListNow = await valueNow(page, 'Resize the list panel');
    const wideSessionNow = await valueNow(page, 'Resize the session panel');

    await resizeTo(app, page, 1200);
    await expect.poll(() => width(page, 'main')).toBeGreaterThanOrEqual(STAGE_MIN - 1);
    expect(await width(page, LIST)).toBeLessThan(wideList);
    expect(await width(page, SESSION)).toBeLessThan(wideSession);
    // The grips follow the drawn rails, not the saved widths.
    await expect.poll(() => valueNow(page, 'Resize the list panel')).not.toBe(wideListNow);
    await expect.poll(() => valueNow(page, 'Resize the session panel')).not.toBe(wideSessionNow);

    // The saved widths were a preference, not rewritten: widening gives them back.
    await resizeTo(app, page, 1440);
    await expect.poll(() => width(page, LIST)).toBeCloseTo(wideList, 0);
    await expect.poll(() => width(page, SESSION)).toBeCloseTo(wideSession, 0);
  } finally {
    await app.close();
  }
});
