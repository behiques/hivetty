import { expect, test } from '@playwright/test';

import { mainWindow } from '../fixtures/hive-app';
import { expectSignInGate, launchLicensed, licenceConfig } from '../fixtures/licence';
import { startStubCloud, USER_CODE, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

/*
  "Getting a code…" shows for a moment before the code arrives. It is not asserted: the stub answers at once,
  and the assertion would race.
*/

test('code sign-in: the gate shows the user code, approval lands on the welcome', async ({}, testInfo) => {
  const { configPath, userDataDir } = licenceConfig(testInfo);
  const app = await launchLicensed({ stub, configPath, userDataDir });
  try {
    const page = await mainWindow(app);
    await page.getByRole('button', { name: 'Sign in with a code instead' }).click();
    await expect(page.getByText(USER_CODE)).toBeVisible({ timeout: 15_000 });
    stub.controls.approveDeviceCode();
    await expect(page.getByText('Welcome, Ada')).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
  }
});

test('code sign-in: a cancel goes back to the gate with no error', async ({}, testInfo) => {
  const { configPath, userDataDir } = licenceConfig(testInfo);
  const app = await launchLicensed({ stub, configPath, userDataDir });
  try {
    const page = await mainWindow(app);
    await page.getByRole('button', { name: 'Sign in with a code instead' }).click();
    await expect(page.getByText(USER_CODE)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expectSignInGate(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
