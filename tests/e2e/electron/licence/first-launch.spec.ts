import { expect, test } from '@playwright/test';

import { mainWindow } from '../fixtures/hive-app';
import {
  expectSignInGate,
  expectWorkspace,
  launchLicensed,
  licenceConfig,
  recordExternal,
  signInWithBrowser,
} from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('first launch: the gate, browser sign-in, the welcome, a trial, the workspace', async ({}, testInfo) => {
  const { configPath, userDataDir } = licenceConfig(testInfo);
  const app = await launchLicensed({ stub, configPath, userDataDir });
  try {
    const page = await mainWindow(app);
    const opened = await recordExternal(app);
    await expectSignInGate(page);
    // Nothing else is reachable: no account menu, no Settings.
    await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Settings/ })).toHaveCount(0);

    await signInWithBrowser(app, page, opened);
    await expect(page.getByText('Welcome, Ada')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start 14-day free trial' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose a plan' })).toBeVisible();

    await page.getByRole('button', { name: 'Start 14-day free trial' }).click();
    await expectWorkspace(page);
    expect(stub.calls.some((call) => call.path === '/api/trial')).toBe(true);
  } finally {
    await app.close();
  }
});
