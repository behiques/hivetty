import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { goToPlace } from '../fixtures/places';

import { writeGhStub } from './fixtures/gh-stub';
import { launchHive, resizeTo, seedJobAcrossDays, writeProjectConfig } from './fixtures/hive-app';

/**
 * Job Flow: the PR page's Flow tab draws a job whose first half is in a day
 * file the ledger store never loads (three days back), so the handoff can only
 * come from `ledger:job`'s thirty-day read, through the real bridge, IPC and
 * main process. Electron only: the web target has no bridge and no PRs.
 */
const PROJECT = 'nova-web';
const REAL_DIRECTORY = join(import.meta.dirname, '../../..');

test('the PR Flow tab draws a job written across two days of ledger files (Job Flow)', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const configPath = testInfo.outputPath('hive-config.json');
  const stub = writeGhStub(testInfo.outputPath(''));
  writeProjectConfig(configPath, {
    id: PROJECT,
    path: REAL_DIRECTORY, // a git checkout: `isRepo` needs a `.git` entry
    env: { PATH: `${stub}:/usr/bin:/bin` },
    importLoginEnv: false,
  });
  seedJobAcrossDays(configPath);
  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('nav[aria-label="Places"]');
    await resizeTo(app, page, 1440);
    await goToPlace(page, 'PRs');
    // The stage auto-opens the first open PR once the sweep lands.
    const flowTab = page.getByRole('main').getByRole('radio', { name: 'Flow' });
    await expect(flowTab).toBeVisible({ timeout: 20_000 });
    await flowTab.click();

    await expect(page.getByRole('img', { name: "The job's parties over time" })).toBeVisible({ timeout: 10_000 });
    // The three-day-old ask is only in its own day file: its handoff proves the thirty-day read.
    await expect(page.getByRole('button', { name: 'a90: sess-flow to shipper' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'a91: shipper to acr' })).toBeVisible();

    await page.getByRole('button', { name: 'a91: shipper to acr' }).click();
    await expect(page.getByText('Selected handoff')).toBeVisible();
    await expect(page.getByText(/^Answered by acr at .* · 10m$/)).toBeVisible();
  } finally {
    await app.close();
  }
});
