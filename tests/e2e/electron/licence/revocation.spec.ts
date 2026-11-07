import { expect, test } from '@playwright/test';

import { startSession } from '../fixtures/hive-app';
import {
  counterLines,
  counterPid,
  isAlive,
  isStopped,
  refreshLicence,
  signedIn,
  writeCounter,
} from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

test('revocation: the revoked gate, with running work suspended', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const counter = writeCounter(testInfo);
  const { app, page } = await signedIn({ stub, testInfo, claudeCommand: counter.script });
  let pid: number | null = null;
  try {
    await startSession(page, 'licence-e2e');
    await expect.poll(() => counterPid(counter), { timeout: 20_000 }).not.toBeNull();
    pid = counterPid(counter)!;
    await expect.poll(() => counterLines(counter).length, { timeout: 10_000 }).toBeGreaterThan(5);

    // Last step on purpose: the stub's `revoked` is never cleared.
    stub.controls.revokeDevice();
    await refreshLicence(page);
    await expect(page.getByRole('heading', { name: 'This Mac was signed out' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
    await expect.poll(() => isStopped(pid!), { timeout: 10_000 }).toBe(true);
    expect(isAlive(pid)).toBe(true);
  } finally {
    if (pid !== null && isAlive(pid)) process.kill(pid, 'SIGKILL');
    await app.close();
  }
});
