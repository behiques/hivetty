import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect as baseExpect, test as baseTest, type Page } from '@playwright/test';

import { goToPlace } from '../fixtures/places';

import { SHIPPED_AGENTS, expect, startUnseeded, test } from './fixtures/hive-app';
import { signedIn } from './fixtures/licence';
import { closeSettings, expectPane, openPane } from './fixtures/settings';
import { startStubCloud, type StubCloud } from './fixtures/stub-cloud';
import { createSwarmRepo, FIXTURE_SWARM, type SwarmRepo } from './fixtures/swarm-repo';

/**
 * HIVE-447 PR 3: a home with no agents or skills says they come in swarms, in the Agents stage, Settings › Skills
 * (and Agents) and Home's middle column, and Install Standard from each installs the registry's Standard row. The
 * row is served by the stub cloud with the slug `standard` and kind `native`, and resolves to the local fixture
 * repository, whose one agent and one skill are what "no longer empty" looks for.
 *
 * Not here: Work's "comes with the Standard swarm" notice on a ticket start. No Electron fixture serves a Jira
 * ticket to the Work tab; PR 2's unit tests and its drive cover it.
 */

const AGENTS_SENTENCE = 'Agents come in swarms. Install Standard for the ticket-to-merge workflow, or browse for others.';
const SKILLS_SENTENCE = 'Skills come in swarms. Install Standard for the ticket-to-merge workflow, or browse for others.';
const HOME_LINE = 'No agents yet. Agents come in swarms.';

/** The registry's Standard row, pointing at the fixture repository's first release. */
const standardRow = (repo: SwarmRepo): Record<string, unknown> => ({
  id: 'standard-fixture',
  slug: 'standard',
  kind: 'native',
  title: 'Standard',
  description: 'The agents and skills most work needs.',
  publisher: 'HiveTTY',
  tags: [],
  updatedAt: '2026-11-19T00:00:00.000Z',
  installs: 3,
  version: repo.releases[0].version,
  commit: repo.releases[0].commit,
  repoUrl: repo.url,
  folder: '',
  access: 'anonymous',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
  agents: [FIXTURE_SWARM.agent],
  skills: [FIXTURE_SWARM.skill],
});

/**
 * Install Standard, then confirm in the consent dialog. Retried as a pair: until the registry listing reaches the
 * renderer there is no row to name, and the button asks to sign in instead (a recorded no-op here).
 */
async function installStandard(page: Page, from: () => ReturnType<Page['getByRole']>): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Install Standard' });
  await baseExpect(async () => {
    await from().click();
    await baseExpect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Install' }).click();
  await baseExpect(dialog).toBeHidden();
  await baseExpect(
    page.getByRole('listitem').filter({ hasText: FIXTURE_SWARM.title }).getByText('v1.0.0 · up to date'),
  ).toBeVisible({ timeout: 30_000 });
}

baseTest.describe('an unseeded home, signed in, with Standard in the registry', () => {
  let stub: StubCloud;
  let dir: string;
  let repo: SwarmRepo;

  baseTest.beforeEach(async ({}, testInfo) => {
    // No built-ins on disk: adoption empties `.seed.json` and writes only the marker (PR 1).
    startUnseeded(testInfo.outputPath('hive-config.json'));
    dir = mkdtempSync(join(tmpdir(), 'hive-swarm-repo-'));
    repo = await createSwarmRepo(dir);
    stub = await startStubCloud();
    stub.controls.setSwarms([standardRow(repo)]);
  });
  baseTest.afterEach(async () => {
    await stub.close();
    rmSync(dir, { recursive: true, force: true });
  });

  baseTest('each empty place says it and offers both starters; Browse lands on Browse', async ({}, testInfo) => {
    const { app, page } = await signedIn({ stub, testInfo, env: repo.env });
    try {
      await goToPlace(page, 'Home');
      const home = page.getByRole('region', { name: 'Agents' });
      await baseExpect(home.getByText(HOME_LINE)).toBeVisible({ timeout: 15_000 });
      await baseExpect(home.getByRole('button', { name: 'Install Standard' })).toBeVisible();
      await baseExpect(home.getByRole('button', { name: 'Browse swarms' })).toBeVisible();

      await openPane(page, 'skills');
      await baseExpect(page.getByText(SKILLS_SENTENCE)).toBeVisible();
      await baseExpect(page.getByRole('button', { name: 'Install Standard' })).toBeVisible();
      await baseExpect(page.getByRole('button', { name: 'Browse swarms' })).toBeVisible();

      await openPane(page, 'agents');
      await baseExpect(page.getByText(AGENTS_SENTENCE)).toBeVisible();
      await baseExpect(page.getByRole('button', { name: 'Install Standard' })).toBeVisible();
      await closeSettings(page);

      await goToPlace(page, 'Agents');
      const main = page.getByRole('main');
      await baseExpect(main.getByRole('heading', { name: 'No agents yet' })).toBeVisible();
      await baseExpect(main.getByText(AGENTS_SENTENCE)).toBeVisible();
      await baseExpect(main.getByRole('button', { name: 'Install Standard' })).toBeVisible();
      await baseExpect(main.getByRole('button', { name: 'New agent', exact: true })).toBeVisible();

      await main.getByRole('button', { name: 'Browse swarms' }).click();
      await expectPane(page, 'swarms');
      await baseExpect(page.getByRole('heading', { name: 'Browse swarms' })).toBeVisible();
      expect(stub.installs).toEqual([]);
    } finally {
      await app.close();
    }
  });

  baseTest('Install Standard from the Agents stage lists its agent', async ({}, testInfo) => {
    const { app, page } = await signedIn({ stub, testInfo, env: repo.env });
    try {
      await goToPlace(page, 'Agents');
      const main = page.getByRole('main');
      await installStandard(page, () => main.getByRole('button', { name: 'Install Standard' }));
      await closeSettings(page);

      await goToPlace(page, 'Agents');
      await baseExpect(page.locator('[data-panel="agents"]').getByText(FIXTURE_SWARM.agent.name)).toBeVisible({
        timeout: 15_000,
      });
      await baseExpect(page.getByRole('heading', { name: 'No agents yet' })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  baseTest('Install Standard from Settings › Skills lists its skill', async ({}, testInfo) => {
    const { app, page } = await signedIn({ stub, testInfo, env: repo.env });
    try {
      await openPane(page, 'skills');
      await baseExpect(page.getByText(SKILLS_SENTENCE)).toBeVisible();
      await installStandard(page, () => page.getByRole('button', { name: 'Install Standard' }));

      await openPane(page, 'skills');
      await baseExpect(page.getByText(`/${FIXTURE_SWARM.skill.name}`).first()).toBeVisible({ timeout: 15_000 });
      await baseExpect(page.getByText(SKILLS_SENTENCE)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  baseTest("Install Standard from Home empties Home's line", async ({}, testInfo) => {
    const { app, page } = await signedIn({ stub, testInfo, env: repo.env });
    try {
      await goToPlace(page, 'Home');
      const home = page.getByRole('region', { name: 'Agents' });
      await baseExpect(home.getByText(HOME_LINE)).toBeVisible({ timeout: 15_000 });
      await installStandard(page, () => home.getByRole('button', { name: 'Install Standard' }));
      await closeSettings(page);

      await goToPlace(page, 'Agents');
      await baseExpect(page.locator('[data-panel="agents"]').getByText(FIXTURE_SWARM.agent.name)).toBeVisible({
        timeout: 15_000,
      });
      await goToPlace(page, 'Home');
      await baseExpect(page.getByText(HOME_LINE)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

test.describe('a seeded home, adopted as Standard (PR 1)', () => {
  test('Swarms shows Standard as Bundled, Agents lists the built-ins, Home never says none', async ({ page }) => {
    await page.waitForSelector('nav[aria-label="Places"]');

    await openPane(page, 'swarms');
    const rows = page.getByRole('listitem');
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    await expect(rows.first()).toContainText('Standard');
    await expect(rows.first()).toContainText('Bundled');
    await closeSettings(page);

    await goToPlace(page, 'Agents');
    const panel = page.locator('[data-panel="agents"]');
    for (const name of SHIPPED_AGENTS) {
      await expect(panel.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
    }

    await goToPlace(page, 'Home');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
    await expect(page.getByText(HOME_LINE)).toHaveCount(0);
  });
});
