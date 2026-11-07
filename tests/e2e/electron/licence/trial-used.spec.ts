import { expect, test } from '@playwright/test';

import { mainWindow } from '../fixtures/hive-app';
import { launchLicensed, licenceConfig, recordExternal, signInWithBrowser } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('trial already used: Start trial is refused and goes away, Choose a plan stays', async ({}, testInfo) => {
  stub.controls.trialUsed(true);
  const { configPath, userDataDir } = licenceConfig(testInfo);
  const app = await launchLicensed({ stub, configPath, userDataDir });
  try {
    const page = await mainWindow(app);
    const opened = await recordExternal(app);
    await signInWithBrowser(app, page, opened);
    // Deviation 1: the app learns this only from the 409 (`electron/main/licence/trial.ts:6`).
    await page.getByRole('button', { name: 'Start 14-day free trial' }).click();
    await expect(page.getByRole('button', { name: 'Start 14-day free trial' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose a plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
