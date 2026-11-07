import { expect, test } from '@playwright/test';

import { mainWindow } from '../fixtures/hive-app';
import { expectWorkspace, launchLicensed, signedIn } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('relaunch: an account and a valid lease open the workspace with no gate and no browser', async ({}, testInfo) => {
  const first = await signedIn({ stub, testInfo });
  await first.app.close();
  const codeGrants = () =>
    stub.calls.filter((call) => call.path === '/api/oauth/token' && call.body.grant_type === 'authorization_code')
      .length;
  const before = codeGrants();

  const app = await launchLicensed({ stub, configPath: first.configPath, userDataDir: first.userDataDir });
  try {
    const page = await mainWindow(app);
    await expectWorkspace(page);
    await expect(page.getByRole('heading', { name: 'Sign in to HiveTTY Pro' })).toHaveCount(0);
    expect(codeGrants()).toBe(before);
  } finally {
    await app.close();
  }
});
