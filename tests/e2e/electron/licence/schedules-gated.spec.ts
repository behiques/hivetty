import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { expectWorkspace, refreshLicence, signedIn } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

/**
 * An agent that wakes every minute, the shortest interval a definition accepts. `check: always` because the
 * default, `onchange`, skips a tick whose ledger is quiet, and this test's ledger always is (`agent-contract.ts`).
 */
const DEFINITION = `---
name: ticker
description: Wakes every minute
icon: Ghost
wake:
  every: 1m
  check: always
---
Do nothing.
`;

test('a wake due during a lapse does not run, then or after renewal', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const runs = testInfo.outputPath('runs.txt');
  const script = testInfo.outputPath('agent.sh');
  // An absolute executable with no arguments (`resolveCommand`), recording each run. It answers --version for CLI detection.
  writeFileSync(
    script,
    `#!/bin/sh\n[ "$1" = --version ] && { echo 'stub 1.0.0'; exit 0; }\ndate +%s >> '${runs}'\n` +
      `printf '%s\\n' '{"type":"result","subtype":"success","num_turns":1,"total_cost_usd":0,"session_id":"stub"}'\n`,
  );
  chmodSync(script, 0o755);
  const count = () => (existsSync(runs) ? readFileSync(runs, 'utf8').split('\n').filter(Boolean).length : 0);

  // Agents are read at launch, so the definition is on disk first. `agentsRoot()` is `dirname(configPath)/agents`
  // (agent-task-runs.spec.ts), and `signedIn`'s config is `testInfo.outputPath('hive-config.json')`.
  const folder = join(dirname(testInfo.outputPath('hive-config.json')), 'agents', 'ticker');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'AGENT.md'), DEFINITION);

  const { app, page } = await signedIn({ stub, testInfo, claudeCommand: script });
  try {
    // The positive control: the schedule really wakes. The first wake is about two minutes in: the boot tick
    // loses its race with the registry, the first sweep (60 s) only arms `nextRunAt`, and the second runs it.
    await expect.poll(count, { timeout: 150_000, intervals: [1_000] }).toBeGreaterThan(0);
    const before = count();

    stub.controls.refuseNext('trial_ended');
    await refreshLicence(page);
    await expect(page.getByRole('heading', { name: 'Your trial has ended' })).toBeVisible();
    // The one deliberate wait in the folder: the lapse has to outlast a real one-minute wake.
    await page.waitForTimeout(70_000);
    expect(count()).toBe(before);

    stub.controls.issueLease({ plan: 'team' });
    await refreshLicence(page);
    await expectWorkspace(page);
    // No catch-up: the wake that fell in the lapse moved to its next slot (ticket, 6 Nov update).
    await page.waitForTimeout(10_000);
    expect(count()).toBe(before);
  } finally {
    await app.close();
  }
});
