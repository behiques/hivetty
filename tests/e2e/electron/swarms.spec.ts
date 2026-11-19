import { expect, test } from '@playwright/test';

import { launchHive, mainWindow } from './fixtures/hive-app';
import { licenceConfig, signedIn } from './fixtures/licence';
import { openPane, settingsNav } from './fixtures/settings';
import { startStubCloud, type StubCloud } from './fixtures/stub-cloud';

/**
 * Settings › Automation › Swarms (HIVE-442 PR 2): the pane, Browse, search and the consent dialog, against the
 * stub cloud's registry. Nothing is installed here: installing clones a Git repository, which PR 3's fixture
 * repository brings. Each row's `repoUrl` is `https://` and never fetched.
 */

const row = (over: Record<string, unknown>): Record<string, unknown> => ({
  tags: [],
  updatedAt: '2026-11-19T00:00:00.000Z',
  installs: 3,
  folder: '',
  commit: null,
  access: 'anonymous',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
  ...over,
});

const ROWS = [
  row({
    id: 'standard',
    slug: 'standard',
    kind: 'native',
    title: 'Standard',
    description: 'The agents and skills most work needs.',
    publisher: 'HiveTTY',
    version: '1.4.0',
    repoUrl: 'https://example.invalid/hivetty/swarms.git',
    folder: 'standard',
    agents: [
      { name: 'builder', description: 'Builds approved plans, task by task.', tools: ['Read', 'Edit', 'Bash'] },
      { name: 'reviewer', description: 'Reviews a branch before it ships.', tools: ['Read', 'Grep', 'Glob'] },
    ],
    skills: [
      { name: 'tdd', description: 'A failing test before any production code.' },
      { name: 'debug', description: 'Root cause before a fix.' },
    ],
  }),
  row({
    id: 'acme-release',
    slug: 'acme-release',
    kind: 'organization',
    title: 'Acme Release',
    description: 'How Acme cuts and ships a release.',
    publisher: 'Acme Platform',
    version: null,
    repoUrl: 'https://example.invalid/acme/release-swarm.git',
    access: 'token',
    org: { id: 'org-acme', name: 'Acme' },
    agents: [{ name: 'release-captain', description: 'Cuts the release branch.', tools: ['Read', 'Bash'] }],
    skills: [{ name: 'changelog', description: 'Writes the changelog from merged PRs.' }],
  }),
  row({
    id: 'docs-kit',
    slug: 'docs-kit',
    kind: 'community',
    title: 'Docs Kit',
    description: 'Keeps a guide in step with the code.',
    publisher: 'Jane Writer',
    version: '0.3.1',
    repoUrl: 'https://example.invalid/jane/docs-kit.git',
    agents: [{ name: 'technical-writer', description: 'Updates the guide after a merge.', tools: ['Read', 'Edit', 'WebFetch'] }],
    skills: [{ name: 'style-guide', description: 'The house style for prose.' }],
  }),
];

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
  stub.controls.setSwarms(ROWS);
});
test.afterEach(async () => {
  await stub.close();
});

test('signed in: Swarms is first in Automation, Browse lists the registry, consent opens and cancels', async ({}, testInfo) => {
  const { app, page } = await signedIn({ stub, testInfo });
  try {
    await openPane(page, 'swarms');

    const automation = settingsNav(page).getByRole('group', { name: 'Automation' });
    await expect(automation.getByRole('button').first()).toHaveText('Swarms');
    await expect(page.getByRole('heading', { name: 'Swarms', level: 2 })).toBeVisible();
    await expect(page.getByText('No swarms installed.')).toBeVisible();

    await page.getByRole('button', { name: 'Browse swarms' }).first().click();
    await expect(page.getByRole('heading', { name: 'Browse swarms' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Native' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Acme' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Community' })).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Search swarms, publishers, agents and skills' });
    await search.fill('release-captain');
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Native' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Acme' }).getByText('Acme Release')).toBeVisible();
    await search.fill('');

    const native = page.getByRole('region', { name: 'Native' });
    await native.getByRole('button', { name: 'Install' }).click();
    const dialog = page.getByRole('dialog', { name: 'Install Standard' });
    await expect(dialog).toBeVisible();
    for (const tool of ['Read', 'Edit', 'Bash', 'Grep', 'Glob']) {
      await expect(dialog.getByText(tool, { exact: true }).first()).toBeVisible();
    }
    await expect(dialog.getByText('/tdd')).toBeVisible();
    await expect(dialog.getByText('Agents in this swarm run on your machine with the tools listed here.')).toBeVisible();
    await expect(dialog).not.toContainText(/model|autonomy/i);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(native.getByRole('button', { name: 'Install' })).toBeVisible();
    // The settings overlay is still open behind it.
    await expect(settingsNav(page)).toBeVisible();
    expect(stub.installs).toEqual([]);
    expect(stub.calls.some((call) => call.method === 'GET' && call.path === '/api/swarms')).toBe(true);

    await page.getByRole('button', { name: 'Installed swarms' }).click();
    await expect(page.getByRole('heading', { name: 'Swarms', level: 2 })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('signed out: Browse asks to sign in', async ({}, testInfo) => {
  const { configPath, userDataDir } = licenceConfig(testInfo);
  const app = await launchHive({ userDataDir, configPath, env: stub.env, args: ['--use-mock-keychain'] });
  try {
    const page = await mainWindow(app);
    // Signed out, the bar carries the gear; wait for it so openPane does not fall back to the chord too early.
    await expect(
      page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Settings', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await openPane(page, 'swarms');

    await page.getByRole('button', { name: 'Browse swarms' }).first().click();

    await expect(page.getByText('Sign in to browse swarms.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect(stub.installs).toEqual([]);
  } finally {
    await app.close();
  }
});
