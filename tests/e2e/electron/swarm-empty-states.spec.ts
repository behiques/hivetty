import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect as baseExpect, test as baseTest, type Page } from '@playwright/test';

import { goToPlace } from '../fixtures/places';

import { expect, launchHive, mainWindow } from './fixtures/hive-app';
import { signedIn } from './fixtures/licence';
import { closeSettings, expectPane, openPane } from './fixtures/settings';
import { startStubCloud, type StubCloud } from './fixtures/stub-cloud';
import { createSwarmRepo, FIXTURE_SWARM, type SwarmRepo } from './fixtures/swarm-repo';

/**
 * HIVE-447 PR 3: a home with no agents or skills says they come in swarms, in the Agents stage, Settings › Skills
 * (and Agents) and Home's middle column, and Install Dev Squad from each installs the registry's Dev Squad row. The
 * row is served by the stub cloud with the slug `dev-squad` and kind `native`, and resolves to the local fixture
 * repository, whose one agent and one skill are what "no longer empty" looks for.
 *
 * Not here: Work's "comes with the Dev Squad swarm" notice on a ticket start. No Electron fixture serves a Jira
 * ticket to the Work tab; PR 2's unit tests and its drive cover it.
 */

const AGENTS_SENTENCE = 'Agents come in swarms. Install Dev Squad for the ticket-to-merge workflow, or browse for others.';
const SKILLS_SENTENCE = 'Skills come in swarms. Install Dev Squad for the ticket-to-merge workflow, or browse for others.';
const HOME_LINE = 'No agents yet. Agents come in swarms.';

/** The registry's Dev Squad row, pointing at the fixture repository's first release. */
const devSquadRow = (repo: SwarmRepo): Record<string, unknown> => ({
  id: 'dev-squad-fixture',
  slug: 'dev-squad',
  kind: 'native',
  title: 'Dev Squad',
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
 * Install Dev Squad, then confirm in the consent dialog. Retried as a pair: until the registry listing reaches the
 * renderer there is no row to name, and the button asks to sign in instead (a recorded no-op here).
 */
async function installDevSquad(page: Page, from: () => ReturnType<Page['getByRole']>): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Install Dev Squad' });
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

baseTest.describe('a fresh home, signed in, with Dev Squad in the registry', () => {
  let stub: StubCloud;
  let dir: string;
  let repo: SwarmRepo;

  baseTest.beforeEach(async () => {
    // HIVE-448: a fresh home has no agents and no skills; boot writes only the adoption marker.
    dir = mkdtempSync(join(tmpdir(), 'hive-swarm-repo-'));
    repo = await createSwarmRepo(dir);
    stub = await startStubCloud();
    stub.controls.setSwarms([devSquadRow(repo)]);
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
      await baseExpect(home.getByRole('button', { name: 'Install Dev Squad' })).toBeVisible();
      await baseExpect(home.getByRole('button', { name: 'Browse swarms' })).toBeVisible();

      await openPane(page, 'skills');
      await baseExpect(page.getByText(SKILLS_SENTENCE)).toBeVisible();
      await baseExpect(page.getByRole('button', { name: 'Install Dev Squad' })).toBeVisible();
      await baseExpect(page.getByRole('button', { name: 'Browse swarms' })).toBeVisible();

      await openPane(page, 'agents');
      await baseExpect(page.getByText(AGENTS_SENTENCE)).toBeVisible();
      await baseExpect(page.getByRole('button', { name: 'Install Dev Squad' })).toBeVisible();
      await closeSettings(page);

      await goToPlace(page, 'Agents');
      const main = page.getByRole('main');
      await baseExpect(main.getByRole('heading', { name: 'No agents yet' })).toBeVisible();
      await baseExpect(main.getByText(AGENTS_SENTENCE)).toBeVisible();
      await baseExpect(main.getByRole('button', { name: 'Install Dev Squad' })).toBeVisible();
      await baseExpect(main.getByRole('button', { name: 'New agent', exact: true })).toBeVisible();

      await main.getByRole('button', { name: 'Browse swarms' }).click();
      await expectPane(page, 'swarms');
      await baseExpect(page.getByRole('heading', { name: 'Browse swarms' })).toBeVisible();
      expect(stub.installs).toEqual([]);
    } finally {
      await app.close();
    }
  });

  baseTest('Install Dev Squad from the Agents stage lists its agent', async ({}, testInfo) => {
    const { app, page } = await signedIn({ stub, testInfo, env: repo.env });
    try {
      await goToPlace(page, 'Agents');
      const main = page.getByRole('main');
      await installDevSquad(page, () => main.getByRole('button', { name: 'Install Dev Squad' }));
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

  baseTest('Install Dev Squad from Settings › Skills lists its skill', async ({}, testInfo) => {
    const { app, page } = await signedIn({ stub, testInfo, env: repo.env });
    try {
      await openPane(page, 'skills');
      await baseExpect(page.getByText(SKILLS_SENTENCE)).toBeVisible();
      await installDevSquad(page, () => page.getByRole('button', { name: 'Install Dev Squad' }));

      await openPane(page, 'skills');
      await baseExpect(page.getByText(`/${FIXTURE_SWARM.skill.name}`).first()).toBeVisible({ timeout: 15_000 });
      await baseExpect(page.getByText(SKILLS_SENTENCE)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  baseTest("Install Dev Squad from Home empties Home's line", async ({}, testInfo) => {
    const { app, page } = await signedIn({ stub, testInfo, env: repo.env });
    try {
      await goToPlace(page, 'Home');
      const home = page.getByRole('region', { name: 'Agents' });
      await baseExpect(home.getByText(HOME_LINE)).toBeVisible({ timeout: 15_000 });
      await installDevSquad(page, () => home.getByRole('button', { name: 'Install Dev Squad' }));
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

/** Two built-ins an older release seeded, recorded in `.seed.json` the way that seed recorded them. */
const OLD_BUILT_INS = ['builder', 'shipper'];

function seededByAnOlderRelease(configPath: string): void {
  const hive = dirname(configPath);
  const files: Record<string, string> = {};
  for (const name of OLD_BUILT_INS) {
    const rel = `agents/${name}/AGENT.md`;
    mkdirSync(join(hive, 'agents', name), { recursive: true });
    writeFileSync(
      join(hive, rel),
      `---\nname: ${name}\ndescription: The ${name}.\nicon: Ghost\nskills: []\ntools: [Read]\n---\nWork.\n`,
    );
    files[rel] = 'seeded';
  }
  writeFileSync(join(hive, '.seed.json'), `${JSON.stringify({ files, parts: {} })}\n`);
}

baseTest.describe('a home an older release seeded, adopted as Dev Squad (HIVE-447, HIVE-448)', () => {
  baseTest('Swarms shows Dev Squad as Bundled, Agents lists the built-ins, Home never says none', async ({}, testInfo) => {
    const configPath = testInfo.outputPath('hive-config.json');
    seededByAnOlderRelease(configPath);
    const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
    try {
      const page = await mainWindow(app);
      await page.waitForSelector('nav[aria-label="Places"]');

      await openPane(page, 'swarms');
      const rows = page.getByRole('listitem');
      await expect(rows).toHaveCount(1, { timeout: 15_000 });
      await expect(rows.first()).toContainText('Dev Squad');
      await expect(rows.first()).toContainText('Bundled');
      await closeSettings(page);

      await goToPlace(page, 'Agents');
      const panel = page.locator('[data-panel="agents"]');
      for (const name of OLD_BUILT_INS) {
        await expect(panel.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
      }

      await goToPlace(page, 'Home');
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
      await expect(page.getByText(HOME_LINE)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
