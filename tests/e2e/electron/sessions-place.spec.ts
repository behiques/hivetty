import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { launchHive, writeProjectConfig } from './fixtures/hive-app';

/**
 * ⌘[ from a session returns to the same Overmind (HIVE-197).
 *
 * The chord's path (`TERMINAL_CHORD_EVENT` → `backToOrch`) is unit-tested on
 * both ends; what only a real window can show is the whole trip: a focused
 * xterm declining the chord, the stage navigating, and the Overmind it lands
 * on still filtered the way it was left, with the caret on the session the
 * user came back from.
 *
 * Electron rather than web: the browser target has no project config and so
 * cannot start a session to come back from.
 */
const PROJECT = 'nova-web';
const REAL_DIRECTORY = join(import.meta.dirname, '../../..');

test('⌘[ from a session returns to the Overmind with the filter kept and the row selected', async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  writeProjectConfig(configPath, { id: PROJECT, path: REAL_DIRECTORY });
  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  try {
    await page.waitForSelector('nav[aria-label="Places"]');

    await page
      .getByRole('navigation', { name: 'Places' })
      .getByRole('button', { name: 'Sessions', exact: true })
      .click();
    await page
      .getByRole('region', { name: 'Sessions list' })
      .getByRole('button', { name: new RegExp(`^${PROJECT}`) })
      .click();
    await page.getByRole('radio', { name: 'Live' }).click();

    /*
      The filtered head's direct spawn, not `startSession`: round two draws two
      exact "New session" buttons (the title bar's and the panel head's "+"),
      and the filtered Overmind is where this story starts one anyway. Scoped
      to the stage, since the panel's project row has a link of the same name.
    */
    await page
      .getByRole('main')
      .getByRole('button', { name: `New session in ${PROJECT}`, exact: true })
      .click();
    const terminal = page.locator('[data-terminal-id^="sess-"]').last();
    await expect(terminal).toBeVisible();
    const id = await terminal.getAttribute('data-terminal-id');
    if (id === null) throw new Error('the spawned session has no terminal id');
    await expect(page.getByTestId('session-header')).toBeVisible();

    /*
      The boot cover lifts on any keystroke (HIVE-101), so a chord pressed under
      it would test the cover. A key the terminal ignores lifts it first, as
      `bare-back-claim.spec.ts` does.
    */
    await page.locator(`[data-terminal-id="${id}"] .xterm-helper-textarea`).focus();
    const cover = page.getByTestId('session-boot-cover');
    if (await cover.isVisible()) {
      await page.keyboard.press('Shift');
      await expect(cover).toHaveCount(0, { timeout: 15_000 });
    }
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+BracketLeft' : 'Control+Shift+ArrowLeft');

    await expect(page.getByRole('heading', { level: 1, name: new RegExp(PROJECT) })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Live' })).toBeChecked();
    // The caret's row, by the marker `fleet-scroll.spec.ts` reads.
    await expect(
      page.getByTestId('session-row').filter({ hasText: id }).and(page.locator('.bg-term-row-active')),
    ).toHaveCount(1);
  } finally {
    await app.close();
  }
});
