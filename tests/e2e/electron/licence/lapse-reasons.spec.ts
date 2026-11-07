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

/** `device_revoked` is `revocation.spec.ts`, and `trial_ended` is `lapse-resume.spec.ts`. */
const CASES: { reason: string; heading: string; action: string }[] = [
  { reason: 'plan_cancelled', heading: 'Your plan has ended', action: 'Choose a plan' },
  // Gated at once even with days left on the lease: the trial lease has 7 days.
  { reason: 'payment_failed', heading: 'Your payment failed', action: 'Update payment method' },
  { reason: 'seat_removed', heading: 'Your seat was removed', action: 'Choose a plan' },
  // Anything the app does not know reads as `unknown` (`lease.ts:40-47`).
  { reason: 'not_a_reason', heading: 'Your licence has lapsed', action: 'Retry' },
];

for (const { reason, heading, action } of CASES) {
  test(`${reason}: "${heading}" with ${action}`, async ({}, testInfo) => {
    const { app, page } = await signedIn({ stub, testInfo });
    try {
      stub.controls.refuseNext(reason);
      await refreshLicence(page);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: action })).toBeVisible();
    } finally {
      await app.close();
    }
  });
}

test('no_plan: the welcome screen', async ({}, testInfo) => {
  const { app, page } = await signedIn({ stub, testInfo });
  try {
    stub.controls.refuseNext('no_plan');
    await refreshLicence(page);
    await expect(page.getByText('Welcome, Ada')).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
  }
});
