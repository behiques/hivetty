import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { launchHive } from './fixtures/hive-app';

/**
 * The stall panel in the built app (HIVE-411): one open ask with its state and age, one refused wake with its
 * reason, one open permission card with its age, all seeded on disk before launch and read by the real main
 * process, ledger store and agent state.
 *
 * Nothing here wakes. The ask is between two sessions that do not exist, so no agent lane takes it; the agent
 * has no `wake:` block, as `agent-task-runs.spec.ts` explains, so no schedule starts a run that would clear
 * its refusal.
 */

const MIN = 60_000;
const pad = (n: number): string => String(n).padStart(2, '0');
/** The store's own day-file name and id shape: local time, `YYYYMMDD-HHMMSS-NNNN`. */
const dayOf = (at: Date): string => `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
const idOf = (ms: number, seq: number): string => {
  const at = new Date(ms);
  return `${String(at.getFullYear())}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${String(seq).padStart(4, '0')}`;
};

const DEFINITION = `---
name: reviewer
description: Reviews pull requests
icon: Eye
---
Review the PR you were given.
`;

test.setTimeout(90_000);

test('the Stalls row shows open asks, refused wakes and permission cards with their ages', async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  const root = dirname(configPath);
  const now = Date.now();
  // Never across midnight: both entries must land in today's file, which the store reads at boot.
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const askAt = Math.max(midnight, now - 41 * MIN);
  const cardAt = Math.max(midnight, now - 17 * MIN);

  writeFileSync(configPath, JSON.stringify({ version: 2, projects: [] }));

  const agentDir = join(root, 'agents', 'reviewer');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'AGENT.md'), DEFINITION);

  const ledgerDir = join(root, 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  const ask = { id: idOf(askAt, 1), ts: askAt, from: 'sess-1b', to: 'sess-9z', kind: 'ask', ref: 'a26', body: 'Build HIVE-411' };
  const card = {
    id: idOf(cardAt, 1),
    ts: cardAt,
    from: 'shipper',
    to: 'overmind',
    kind: 'ask',
    ref: 'a27',
    body: 'Allow Bash: gh pr checks 281?',
    meta: { kind: 'permission' },
  };
  writeFileSync(join(ledgerDir, `${dayOf(today)}.jsonl`), `${JSON.stringify(ask)}\n${JSON.stringify(card)}\n`, { mode: 0o600 });
  writeFileSync(
    join(ledgerDir, 'agents.json'),
    JSON.stringify({
      reviewer: {
        status: 'sleeping',
        runsSinceRotate: 0,
        runs: [],
        refused: { reason: 'budget', at: now - 5 * MIN },
        pendingWake: [{ kind: 'ask', id: 'q1', from: 'sess-1b', ref: 'a25' }],
      },
    }),
  );

  const app = await launchHive({
    userDataDir: testInfo.outputPath('user-data'),
    configPath,
    env: { CLAUDE_CONFIG_DIR: testInfo.outputPath('claude-config') },
  });
  const page = await app.firstWindow();

  try {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('nav[aria-label="Places"]');

    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Agents/ }).click();
    await page.getByRole('button', { name: /^Stalls/ }).click();

    const stalls = page.getByRole('region', { name: 'Stalls' });
    await expect(stalls).toBeVisible();

    const askRow = stalls.getByRole('region', { name: 'Open asks' }).getByRole('row').filter({ hasText: 'a26' });
    await expect(askRow).toContainText('open');
    await expect(askRow).toContainText(/\d+m/);

    /*
      The reason is main's, not the seed's: at boot the scheduler retries the queued wake, and its own refusal
      (an agent that cannot start here: `invalid`, `cli`, or the seeded `budget`) replaces the seeded one. What
      is asserted is that a refused lane reaches the panel with a reason and its queue.
    */
    const refused = stalls.getByRole('region', { name: 'Refused wakes' });
    await expect(refused).toContainText('reviewer');
    await expect(refused).toContainText(/budget|invalid|cli/);
    await expect(refused).toContainText('standing lane · 1 queued');

    const cards = stalls.getByRole('region', { name: 'Permission cards' });
    await expect(cards).toContainText('shipper');
    await expect(cards).toContainText(/\d+m/);

    await testInfo.attach('stall-panel', { body: await stalls.screenshot(), contentType: 'image/png' });
  } finally {
    await app.close();
  }
});
