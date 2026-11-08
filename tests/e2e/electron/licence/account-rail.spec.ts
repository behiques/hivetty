import { expect, test } from '@playwright/test';

import { signedIn } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('signed in: the avatar is last on the bar, no gear; its menu and ⌘, open Settings', async ({}, testInfo) => {
  const { app, page } = await signedIn({ stub, testInfo });
  try {
    const bar = page.getByRole('navigation', { name: 'Places' });
    // Named "Account, <org>" once the active org is known.
    await expect(bar.getByRole('button').last()).toHaveAccessibleName(/^Account/);
    await expect(bar.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);

    await bar.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Settings…' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  } finally {
    await app.close();
  }
});
