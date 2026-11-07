import { expect, test } from '@playwright/test';

import { mainWindow, runHiveCli } from '../fixtures/hive-app';
import { expectSignInGate, launchLicensed, licenceConfig } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('a gated instance unlocks after --login in a second process, and --logout gates it again', async ({}, testInfo) => {
  test.setTimeout(90_000);
  stub.controls.setPlan('team');
  stub.controls.approveDeviceCode();
  const dirs = licenceConfig(testInfo);
  const app = await launchLicensed({ stub, ...dirs });
  try {
    const page = await mainWindow(app);
    await expectSignInGate(page);

    const login = await runHiveCli({ args: ['--login', '--use-mock-keychain'], ...dirs, env: stub.env });
    expect(login.code).toBe(0);
    // fs.watch normally fires at once. The 30 s reload interval is the worst case (HIVE-266).
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible({ timeout: 35_000 });

    const logout = await runHiveCli({ args: ['--logout', '--use-mock-keychain'], ...dirs, env: stub.env });
    expect(logout.code).toBe(0);
    await expect(page.getByRole('heading', { name: 'Sign in to HiveTTY Pro' })).toBeVisible({ timeout: 35_000 });
  } finally {
    await app.close();
  }
});
