import { expect, test } from '@playwright/test';

import { refreshLicence, signedIn } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('trial warnings: 3 days shows, dismissed, 1 day shows again', async ({}, testInfo) => {
  // `startTrialLease` ends a minute short of whole days, so `trialDaysLeft`'s ceil reads exactly 3, then 1.
  stub.controls.startTrialLease({ endsInDays: 3 });
  const { app, page } = await signedIn({ stub, testInfo, trial: false });
  try {
    await expect(page.getByText('Your trial ends in 3 days.')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('Your trial ends in 3 days.')).toHaveCount(0);

    // A dismissal holds only until the next threshold (`banner.ts`), so no relaunch.
    stub.controls.startTrialLease({ endsInDays: 1 });
    await refreshLicence(page);
    await expect(page.getByText('Your trial ends tomorrow.')).toBeVisible();
  } finally {
    await app.close();
  }
});
