import { expect, test } from '@playwright/test';

import { startSession } from '../fixtures/hive-app';
import {
  counterLines,
  counterPid,
  expectWorkspace,
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

test('a trial_ended lapse stops the counter (T); a new lease resumes it in the same PTY', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const counter = writeCounter(testInfo);
  const { app, page } = await signedIn({ stub, testInfo, claudeCommand: counter.script });
  let pid: number | null = null;
  try {
    await startSession(page, 'licence-e2e');
    await expect.poll(() => counterPid(counter), { timeout: 20_000 }).not.toBeNull();
    pid = counterPid(counter)!;
    await expect.poll(() => counterLines(counter).length, { timeout: 10_000 }).toBeGreaterThan(5);

    stub.controls.refuseNext('trial_ended');
    await refreshLicence(page);
    await expect(page.getByRole('heading', { name: 'Your trial has ended' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose a plan' })).toBeVisible();
    await expect.poll(() => isStopped(pid!), { timeout: 10_000 }).toBe(true);
    const stoppedAt = counterLines(counter).length;

    stub.controls.issueLease({ plan: 'team' });
    await refreshLicence(page);
    await expectWorkspace(page);
    await expect.poll(() => counterLines(counter).length, { timeout: 10_000 }).toBeGreaterThan(stoppedAt + 3);
    // The same process carried on: no gap, no restart from 1, same pid, alive, not stopped.
    const lines = counterLines(counter);
    expect(lines.every((n, i) => n === i + 1)).toBe(true);
    expect(counterPid(counter)).toBe(pid);
    expect(isAlive(pid)).toBe(true);
    expect(isStopped(pid)).toBe(false);
  } finally {
    if (pid !== null && isAlive(pid)) process.kill(pid, 'SIGKILL');
    await app.close();
  }
});
