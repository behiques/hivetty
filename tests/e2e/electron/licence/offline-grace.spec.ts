import { expect, test } from '@playwright/test';

import { mainWindow } from '../fixtures/hive-app';
import { expectWorkspace, launchLicensed, licenceKind, refreshLicence, signedIn } from '../fixtures/licence';
import { DAY_S, nowS, startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('offline: grace with 6 days left, the banner at 3, lapsed on relaunch, Retry back online', async ({}, testInfo) => {
  test.setTimeout(120_000);
  // `issueLease({ exp })` on a null plan still refuses `no_plan`, so the plan is set first.
  stub.controls.setPlan('team');
  const first = await signedIn({ stub, testInfo, trial: false });
  const { page } = first;

  // 6 days left, then offline: the renewal fails, and the app is in grace and still working.
  stub.controls.issueLease({ exp: nowS() + 6 * DAY_S });
  await refreshLicence(page);
  await stub.controls.offline();
  await refreshLicence(page);
  await expect.poll(() => licenceKind(page)).toBe('grace');
  await expectWorkspace(page);
  await expect(page.getByText(/^Offline for/)).toHaveCount(0);

  // 3 days left, issued 4 days ago: the offline banner.
  await stub.controls.online();
  stub.controls.issueLease({ iat: nowS() - 4 * DAY_S, exp: nowS() + 3 * DAY_S });
  await refreshLicence(page);
  await stub.controls.offline();
  await refreshLicence(page);
  await expect(page.getByText('Offline for 4 days.')).toBeVisible();
  await expect(page.getByText(/Connect within 3 days/)).toBeVisible();

  // A lease that ends in a few seconds, then quit, then wait it out offline, then relaunch.
  await stub.controls.online();
  const exp = nowS() + 5;
  stub.controls.issueLease({ iat: nowS() - 7 * DAY_S, exp });
  await refreshLicence(page);
  await first.app.close();
  await stub.controls.offline();
  await expect.poll(() => nowS() > exp, { timeout: 10_000 }).toBe(true);

  const app = await launchLicensed({ stub, configPath: first.configPath, userDataDir: first.userDataDir });
  try {
    const relaunched = await mainWindow(app);
    await expect(relaunched.getByRole('heading', { name: "Can't reach HiveTTY" })).toBeVisible({ timeout: 15_000 });
    const retry = relaunched.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    // The ticket asks for Retry first: it is the offline view's primary, and only, action.
    await expect(relaunched.getByRole('button').first()).toHaveText('Retry');

    await stub.controls.online();
    stub.controls.issueLease({});
    await retry.click();
    await expectWorkspace(relaunched);
  } finally {
    await app.close();
  }
});
