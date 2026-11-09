import { readFileSync } from 'node:fs';

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Settings helpers shared by the HIVE-60 specs: open a pane by its stable id, assert which one is open, and read the
 * sandboxed config back. Panes are addressed by `data-pane` (HIVE-374), never by label, so a renamed pane breaks the
 * spec that named it and nothing else.
 */

/** The file as the app wrote it; specs pick at it, as every settings spec's own `read` did. */
export const readConfig = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

export const settingsNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Settings sections' });

/** Asserts the open pane: its nav button is the current page. */
export async function expectPane(page: Page, id: string): Promise<void> {
  await expect(settingsNav(page).locator(`[data-pane="${id}"]`)).toHaveAttribute('aria-current', 'page');
}

/** Opens Settings if it is closed, then the pane with this id. */
export async function openPane(page: Page, id: string): Promise<void> {
  if (!(await settingsNav(page).isVisible())) {
    // Signed in, the avatar replaces the gear on the bar; ⌘, opens Settings either way.
    const gear = page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Settings', exact: true });
    if (await gear.count()) await gear.click();
    else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  }
  await settingsNav(page).locator(`[data-pane="${id}"]`).click();
  await expectPane(page, id);
}

export async function closeSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(settingsNav(page)).toBeHidden();
}
