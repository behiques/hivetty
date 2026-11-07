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

test('choose a plan: the one-time link for /account/plan, then the app unlocks by itself', async ({}, testInfo) => {
  const { configPath, userDataDir } = licenceConfig(testInfo);
  const app = await launchLicensed({ stub, configPath, userDataDir });
  try {
    const page = await mainWindow(app);
    const opened = await recordExternal(app);
    await signInWithBrowser(app, page, opened);
    await page.getByRole('button', { name: 'Choose a plan' }).click();
    await expect
      .poll(async () => (await opened()).find((url) => url.includes('/redeem')))
      .toBe(`${stub.url}/redeem?next=${encodeURIComponent('/account/plan')}`);
    await expect(page.getByText('Finish in your browser…')).toBeVisible();

    stub.controls.completeCheckout('team');
    // The purchase watch renews every 5 s (`licence-state.ts:10`), so 10 s allows one missed poll.
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});
