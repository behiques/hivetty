import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { expectSignInGate, signedIn } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('sign out: back to the gate, account.bin gone, /revoke called', async ({}, testInfo) => {
  const { app, page, userDataDir } = await signedIn({ stub, testInfo });
  try {
    expect(existsSync(join(userDataDir, 'account.bin'))).toBe(true);
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    const confirm = page.getByRole('dialog', { name: 'Sign out of HiveTTY Pro?' });
    await confirm.getByRole('button', { name: 'Sign out' }).click();

    await expectSignInGate(page);
    await expect.poll(() => existsSync(join(userDataDir, 'account.bin'))).toBe(false);
    await expect.poll(() => stub.calls.some((call) => call.path === '/api/oauth/revoke')).toBe(true);
  } finally {
    await app.close();
  }
});
