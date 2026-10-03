import { expect, type Page } from '@playwright/test';

/**
 * Driving the agent page's Definition view from a browser test (HIVE-204).
 *
 * Authoring moved out of Settings › Agents onto the agent's own page. Settings
 * keeps the list and "+ New agent", and both now open the page on Definition
 * and close Settings on the way — so every spec that authored in the pane
 * starts here instead.
 */

/** Settings › Agents, as every authoring flow reaches it. */
export async function openSettingsAgents(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Agents' }).click();
}

/**
 * Open a new agent's page from Settings › Agents.
 *
 * `exact`, because the agents panel's own "+ New agent…" can be on screen
 * beside the overlay and contains the same words.
 */
export async function newAgentPage(page: Page): Promise<void> {
  await openSettingsAgents(page);
  await page.getByRole('button', { name: '+ New agent', exact: true }).click();
  await expect(page.locator('[data-view="agent"]')).toBeVisible();
  await expect(page.getByText('New agent', { exact: true })).toBeVisible();
}

/**
 * Below 900px of stage the editor keeps its Form | Source tabs; at or above,
 * both panes already show and the tabs are hidden. Either way, after this the
 * named pane is on screen.
 */
async function show(page: Page, pane: 'Form' | 'Source'): Promise<void> {
  const tab = page.getByRole('tab', { name: pane });
  if (await tab.isVisible()) await tab.click();
}

export const showSource = (page: Page): Promise<void> => show(page, 'Source');
export const showForm = (page: Page): Promise<void> => show(page, 'Form');

/** Save landed: the bar names the file and reads saved. */
export async function expectSavedAs(page: Page, name: string): Promise<void> {
  await expect(page.getByText(new RegExp(`/${name}/AGENT\\.md$`))).toBeVisible();
  await expect(page.getByText('saved', { exact: true })).toBeVisible();
}
