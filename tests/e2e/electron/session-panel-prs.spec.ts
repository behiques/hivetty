import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  HOOK_HEADER_SESSION,
  HOOK_HEADER_TOKEN,
} from '../../../electron/shared/hook-contract';
import { LEDGER_POST_PATH } from '../../../electron/shared/ledger-contract';

import { STUB_PR, STUB_REPO, writeGhStub } from './fixtures/gh-stub';
import { launchHive, startSession, writeProjectConfig } from './fixtures/hive-app';

/**
 * A session's PRs are its own, not its branch's (the sess-19 bug), and one
 * session can own several: its PR tab lists them and a chip picks which one it
 * shows. Driven in the built app, with the PRs claimed the way every hive flow
 * claims them, an ask to the shipper from the session's own shell.
 */
const PROJECT = 'nova-web';
const REAL_DIRECTORY = join(import.meta.dirname, '../../..');

async function shell(page: Page, sessionId: string, command: string): Promise<void> {
  await page.evaluate(
    ([id, data]) => {
      window.hive!.pty.write({ sessionId: id!, data: data! });
    },
    [sessionId, `${command}\n`],
  );
}

/** An ask to the shipper naming `pr`, posted from the session's shell; its HTTP status lands in `marker`. */
function claimCommand(pr: number, marker: string): string {
  const payload = JSON.stringify({ to: 'shipper', kind: 'ask', body: `ship #${String(pr)}`, meta: { pr, repo: STUB_REPO } });
  return (
    `curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST "$${HOOK_ENV_RECEIVER_URL}${LEDGER_POST_PATH}"` +
    ` -H "${HOOK_HEADER_SESSION}: $${HOOK_ENV_SESSION}"` +
    ` -H "${HOOK_HEADER_TOKEN}: $${HOOK_ENV_TOKEN}"` +
    ` -H "content-type: application/json"` +
    ` --data-binary '${payload}'` +
    ` > '${marker}'`
  );
}

test('the PR tab lists every PR the session claimed and a chip picks which one it shows', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const configPath = testInfo.outputPath('hive-config.json');
  const stub = writeGhStub(testInfo.outputPath(''));
  writeProjectConfig(configPath, {
    id: PROJECT,
    path: REAL_DIRECTORY,
    env: { PATH: `${stub}:/usr/bin:/bin` },
    importLoginEnv: false,
  });
  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('nav[aria-label="Places"]');
    const session = await startSession(page, PROJECT);

    // The stub's sweep holds PR 7; PR 8 is one it cannot see, so it reads as remembered.
    for (const pr of [STUB_PR, STUB_PR + 1]) {
      const marker = testInfo.outputPath(`claim-${String(pr)}.status`);
      await shell(page, session, claimCommand(pr, marker));
      await expect.poll(() => (existsSync(marker) ? readFileSync(marker, 'utf8') : ''), { timeout: 10_000 }).toBe('200');
    }

    const tab = page.getByRole('tab', { name: /^PRs 2/ });
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await tab.click();

    const picker = page.getByRole('group', { name: 'Pull requests' });
    const live = picker.getByRole('button', { name: `#${String(STUB_PR)}` });
    const remembered = picker.getByRole('button', { name: `#${String(STUB_PR + 1)}` });
    // Open before remembered: the sweep can see #7.
    await expect(live).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Narrow stage fixture')).toBeVisible();

    await remembered.click();
    await expect(remembered).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(`#${String(STUB_PR + 1)} · last seen`)).toBeVisible();

    await live.click();
    await expect(page.getByText('Narrow stage fixture')).toBeVisible();
  } finally {
    await app.close();
  }
});
