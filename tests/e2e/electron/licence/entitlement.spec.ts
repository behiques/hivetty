import { expect, test } from '@playwright/test';

import { signedIn } from '../fixtures/licence';
import { openPane, settingsNav } from '../fixtures/settings';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

/**
 * HIVE-332, deferred from HIVE-270: on a Solo lease Copilot is locked and Codex is not. Control (run once by hand,
 * noted in the PR): `setPlan('team')` makes the `Locked: Team` assertion fail.
 */
test('a Solo lease locks Copilot, not Codex, and Upgrade opens the plan page', async ({}, testInfo) => {
  stub.controls.setPlan('solo');
  const { app, page, opened } = await signedIn({ stub, testInfo, trial: false });
  try {
    await openPane(page, 'codex');
    const nav = settingsNav(page);
    await expect(nav.locator('[data-pane="copilot"]').getByLabel('Locked: Team')).toBeVisible();
    await expect(nav.locator('[data-pane="codex"]').getByLabel(/^Locked/)).toHaveCount(0);

    await openPane(page, 'copilot');
    await expect(page.getByRole('note', { name: 'Copilot is in Team and above' })).toBeVisible();
    await page.getByRole('note').getByRole('button', { name: 'Upgrade' }).click();
    await expect
      .poll(async () => (await opened()).find((url) => url.includes('/redeem')))
      .toBe(`${stub.url}/redeem?next=${encodeURIComponent('/account/plan')}`);
  } finally {
    await app.close();
  }
});
