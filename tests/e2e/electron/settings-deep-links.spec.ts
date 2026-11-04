import { writeFileSync } from 'node:fs';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { goToOvermind, goToPlace, openProject, overmindNewSession } from '../fixtures/places';

import { launchHive } from './fixtures/hive-app';
import { closeSettings, expectPane, openPane, settingsNav } from './fixtures/settings';

/**
 * Every `openSettings(id)` caller in the app opens the pane HIVE-374 to HIVE-380 say it does (HIVE-60), through the
 * real control a person clicks. The unit suite proves the store resolves each id, the legacy ones included; only the
 * built app proves the click reaches the overlay and lands on that pane.
 *
 * One launch per seed the links need: an empty config, an exposed receiver, an unmapped project.
 *
 * Not here: the connection item's Serving row. Its link is the same `settingsLink` button the Exposed row proves below,
 * with `server-mode` for `containers`, which `connection-item.test.tsx` asserts. Serving for real means booting server
 * mode, which claims a server lock outside the `HIVE_CONFIG_PATH` sandbox; `pnpm test:server` owns that boot.
 */

async function launch(outputPath: (name: string) => string, config: object): Promise<{ app: ElectronApplication; page: Page }> {
  const configPath = outputPath('hive-config.json');
  writeFileSync(configPath, JSON.stringify(config));
  const app = await launchHive({ userDataDir: outputPath('user-data'), configPath });
  const page = await app.firstWindow();
  await page.waitForSelector('nav[aria-label="Places"]');
  return { app, page };
}

const EMPTY = { version: 2, shell: '/bin/sh', projects: [] };

test('the empty app: first-run, Work, the bare openers and the cross-links between panes', async ({}, testInfo) => {
  const { app, page } = await launch((name) => testInfo.outputPath(name), EMPTY);

  try {
    // Home's first run, step 2.
    await goToPlace(page, 'Home');
    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    await expectPane(page, 'integrations');
    await closeSettings(page);

    // Work with no Jira: both links on the setup page.
    for (const label of ['Connect Jira', 'Learn what HiveTTY reads']) {
      await goToPlace(page, 'Work');
      await page.getByRole('button', { name: label }).click();
      await expectPane(page, 'integrations');
      await closeSettings(page);
    }

    // The bare openers name no pane, so Settings opens on Projects.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expectPane(page, 'projects');
    await closeSettings(page);

    await goToOvermind(page);
    await overmindNewSession(page).click();
    await page.getByRole('button', { name: 'Add project', exact: true }).click();
    await expectPane(page, 'projects');

    // Links between panes. Integrations → Ticket workflow, and back while Jira has no site.
    await openPane(page, 'integrations');
    await page.getByRole('button', { name: 'Open Ticket workflow' }).click();
    await expectPane(page, 'ticket-workflow');
    await page
      .getByText(/Sessions start from tickets once Jira is connected/)
      .getByRole('button', { name: 'Integrations', exact: true })
      .click();
    await expectPane(page, 'integrations');

    // Overview → a CLI's page.
    await openPane(page, 'harnesses-overview');
    await page.getByRole('button', { name: /· Open Codex$/ }).click();
    await expectPane(page, 'codex');

    // Containers → a CLI's page, by its name in the table.
    await openPane(page, 'containers');
    await page.getByRole('rowheader').getByRole('button', { name: 'Copilot', exact: true }).click();
    await expectPane(page, 'copilot');
  } finally {
    await app.close();
  }
});

test('an exposed receiver: the connection item links to Containers', async ({}, testInfo) => {
  const { app, page } = await launch((name) => testInfo.outputPath(name), {
    ...EMPTY,
    receiver: { hostAlias: 'host.docker.internal', bind: { host: '0.0.0.0', port: 0, allowedOrigins: [] } },
  });

  try {
    await page.getByTestId('connection-item').click();
    const popover = page.getByRole('dialog', { name: 'Connection' });
    await popover.getByRole('button', { name: 'Settings › Harnesses › Containers' }).click();
    await expectPane(page, 'containers');
    await expect(popover).toBeHidden();
  } finally {
    await app.close();
  }
});

test('an unmapped project: the selected row links to Projects', async ({}, testInfo) => {
  const { app, page } = await launch((name) => testInfo.outputPath(name), {
    ...EMPTY,
    projects: [{ id: 'referral-api', name: 'referral-api', path: '/nowhere/that/exists' }],
  });

  try {
    const list = await openProject(page, 'referral-api');
    await list.getByRole('button', { name: /^referral-api/ }).click();
    await list.getByRole('button', { name: /^(Map|Fix) it in Settings$/ }).click();
    await expectPane(page, 'projects');
    await expect(settingsNav(page)).toBeVisible();
  } finally {
    await app.close();
  }
});
