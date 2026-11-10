import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { goToPlace } from '../fixtures/places';

import { launchHive } from './fixtures/hive-app';

/**
 * Each CLI's headless agent settings, driven through the real app (HIVE-341). Since HIVE-376 they sit on
 * Settings › Harnesses › <CLI>, and the default CLI for agents on Settings › Agents.
 *
 * The unit suite proves the parser, the guard, the setter and the card against fakes. This proves
 * the card's write reaches the file, and that the next wake reads it: the model lands on the argv
 * of a run whose `AGENT.md` names none, and turning Claude off refuses the run with its reason.
 *
 * `HIVE_CONFIG_PATH` points at a scratch file, so nothing here touches `~/.hivetty/config.json`.
 */

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

/** Opens Settings on a pane by its nav label: a CLI's page, or Agents. */
const openPane = async (page: Page, label: string): Promise<void> => {
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  if (!(await nav.isVisible())) {
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  }
  await nav.getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`^${label}`), level: 2 })).toBeVisible();
};

/** The page's Headless agents group: the agents settings on a CLI's page. */
const agentsGroup = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Headless agents' }) });

test('the card writes the file, and off disables the defaults', async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  writeFileSync(configPath, JSON.stringify({ version: 2, projects: [] }));

  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('nav[aria-label="Places"]');
    await openPane(page, 'Claude Code');

    const claude = agentsGroup(page);
    const model = claude.getByRole('combobox', { name: 'Model' });
    await expect(model).toHaveValue('');
    await model.selectOption('haiku');
    await expect.poll(() => read(configPath).clis?.['claude-code']?.agents?.model).toBe('haiku');
    await page.screenshot({ path: testInfo.outputPath('clis-on.png') });

    await claude.getByRole('switch', { name: 'Enabled for agents' }).click();
    await expect.poll(() => read(configPath).clis['claude-code'].agents.enabled).toBe(false);
    await expect(model).toBeDisabled();
    await expect(claude.getByRole('switch', { name: 'Enabled for agents' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByText(/agents skip Claude Code/)).toBeVisible();
    // The switch's colour eases over; shoot the settled frame, not the transition.
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.screenshot({ path: testInfo.outputPath('clis-off.png') });

    // The file keeps the model while the CLI is off: off is not a clear.
    expect(read(configPath).clis['claude-code'].agents.model).toBe('haiku');
  } finally {
    await app.close();
  }
});

test("the default CLI and codex's sandbox write the file (HIVE-342)", async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  writeFileSync(configPath, JSON.stringify({ version: 2, projects: [] }));

  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('nav[aria-label="Places"]');
    await openPane(page, 'Agents');

    const fallback = page.getByRole('combobox', { name: 'Default CLI for agents' });
    await expect(fallback).toHaveValue('claude-code');
    await fallback.selectOption('codex');
    await expect.poll(() => read(configPath).agentsDefaultCli).toBe('codex');

    await openPane(page, 'Codex');
    const codex = agentsGroup(page);
    const sandbox = codex.getByRole('combobox', { name: 'Sandbox' });
    await expect(sandbox).toHaveValue('workspace-write');
    await sandbox.selectOption('read-only');
    await expect.poll(() => read(configPath).clis?.codex?.agents?.sandbox).toBe('read-only');
    await codex.getByRole('combobox', { name: 'Model' }).selectOption('gpt-6-luna');
    await expect.poll(() => read(configPath).clis.codex.agents.model).toBe('gpt-6-luna');
    await openPane(page, 'Claude Code');
    await expect(agentsGroup(page).getByRole('combobox', { name: 'Sandbox' })).toHaveCount(0);

    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.screenshot({ path: testInfo.outputPath('clis-codex.png'), fullPage: true });
  } finally {
    await app.close();
  }
});

/** Settings › Appearance › Mode, then back to Copilot's page. */
const setMode = async (page: Page, mode: 'Light' | 'Dark'): Promise<void> => {
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Appearance', exact: true })
    .click();
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: mode }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Copilot', exact: true })
    .click();
};

/**
 * The Copilot card (HIVE-343). The token is shown in its empty state only: storing one would write
 * through the runner's real keychain, which `jira-settings.spec.ts` declines for the same reason.
 * The store and the clear are proven against an injected store in `cli-tokens.test.ts`.
 */
test("copilot's deny patterns write the file, and its token field is write-only (HIVE-343)", async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  writeFileSync(configPath, JSON.stringify({ version: 2, projects: [] }));

  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('nav[aria-label="Places"]');
    await openPane(page, 'Copilot');

    const copilot = page.getByRole('dialog');
    await expect(copilot.getByRole('textbox', { name: 'Token' })).toHaveAttribute('placeholder', 'gho_… or github_pat_…');
    await expect(copilot.getByRole('textbox', { name: 'Token' })).toHaveAttribute('type', 'password');
    await expect(copilot.getByRole('button', { name: 'Clear token' })).toHaveCount(0);

    await copilot.getByRole('button', { name: 'Add pattern' }).click();
    await copilot.getByRole('textbox', { name: 'Deny pattern 1', exact: true }).fill('shell(rm:*)');
    await copilot.getByRole('textbox', { name: 'Deny pattern 1', exact: true }).blur();
    await expect.poll(() => read(configPath).clis?.copilot?.agents?.deny).toEqual(['shell(rm:*)']);

    await copilot.getByRole('button', { name: 'Add pattern' }).click();
    await copilot.getByRole('textbox', { name: 'Deny pattern 2', exact: true }).fill('not valid');
    await copilot.getByRole('textbox', { name: 'Deny pattern 2', exact: true }).blur();
    await expect(copilot.getByText('Use kind(argument), like shell(git push) or write(.env)')).toBeVisible();
    expect(read(configPath).clis.copilot.agents.deny).toEqual(['shell(rm:*)']);

    for (const mode of ['Dark', 'Light'] as const) {
      await setMode(page, mode);
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await agentsGroup(page).screenshot({ path: testInfo.outputPath(`clis-copilot-${mode.toLowerCase()}.png`) });
    }

    // The mode switch remounted the card from the file, so the unsaved invalid row is gone.
    // Removing the last pattern writes an empty list, which deletes the key.
    const card = agentsGroup(page);
    await expect(card.getByRole('textbox', { name: 'Deny pattern 2', exact: true })).toHaveCount(0);
    await card.getByRole('button', { name: 'Remove deny pattern 1' }).click();
    await expect.poll(() => read(configPath).clis.copilot.agents.deny).toBeUndefined();
  } finally {
    await app.close();
  }
});

/** A `claude` that records its argv and answers with the `stream-json` lines the fold reads. */
const stub = (argvFile: string) => `#!/bin/sh
printf '%s\\n' "$@" > '${argvFile}'
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"stub","mcp_servers":[]}'
printf '%s\\n' '{"type":"result","subtype":"success","num_turns":1,"total_cost_usd":0.001,"session_id":"stub"}'
`;

const DEFINITION = `---
name: sweeper
description: Sweeps once when asked
icon: Ghost
---
Sweep the channel.
`;

const seedAgent = (testInfo: { outputPath: (name: string) => string }, agents: object) => {
  const configPath = testInfo.outputPath('hive-config.json');
  const argvFile = testInfo.outputPath('argv.txt');
  const binary = testInfo.outputPath('stub-claude');
  const folder = join(dirname(configPath), 'agents', 'sweeper');

  writeFileSync(binary, stub(argvFile));
  chmodSync(binary, 0o755);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'AGENT.md'), DEFINITION);
  writeFileSync(
    configPath,
    JSON.stringify({ version: 2, projects: [], claudeCommand: binary, clis: { 'claude-code': { agents } } }),
  );

  return { configPath, argvFile };
};

const runSweeper = async (page: Page): Promise<void> => {
  await page.waitForSelector('nav[aria-label="Places"]');
  await goToPlace(page, 'Agents');
  const panel = page.locator('[data-panel="agents"]');
  await panel.getByRole('button', { name: /^sweeper, / }).hover();
  await panel.getByRole('button', { name: 'Run sweeper now' }).click();
};

test("a wake takes the card's model when AGENT.md names none", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const { configPath, argvFile } = seedAgent(testInfo, { model: 'haiku', effort: 'low' });

  const app = await launchHive({
    userDataDir: testInfo.outputPath('user-data'),
    configPath,
    env: { CLAUDE_CONFIG_DIR: testInfo.outputPath('claude-config') },
  });
  const page = await app.firstWindow();

  try {
    await runSweeper(page);

    await expect.poll(() => existsSync(argvFile), { timeout: 30_000 }).toBe(true);
    const argv = readFileSync(argvFile, 'utf8').split('\n');
    expect(argv[argv.indexOf('--model') + 1]).toBe('haiku');
    expect(argv[argv.indexOf('--effort') + 1]).toBe('low');
  } finally {
    await app.close();
  }
});

test('a wake with Claude turned off is refused, and says why', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const { configPath, argvFile } = seedAgent(testInfo, { enabled: false });

  const app = await launchHive({
    userDataDir: testInfo.outputPath('user-data'),
    configPath,
    env: { CLAUDE_CONFIG_DIR: testInfo.outputPath('claude-config') },
  });
  const page = await app.firstWindow();

  try {
    await runSweeper(page);

    await expect(
      page.getByText(/claude-code is turned off for agents in Settings › Harnesses/).first(),
    ).toBeVisible({ timeout: 30_000 });
    expect(existsSync(argvFile)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('clis-refused.png') });
  } finally {
    await app.close();
  }
});

/** The real codex on this machine, for the plugin install below; the spec skips without one (HIVE-372). */
const realCodex = spawnSync('/bin/sh', ['-lc', 'command -v codex'], { encoding: 'utf8' }).stdout.trim();

test("installing HiveTTY's skills into Codex, on and off, against a scratch CODEX_HOME (HIVE-372)", async ({}, testInfo) => {
  test.skip(realCodex === '', 'codex is not installed on this machine');
  test.setTimeout(120_000);
  const configPath = testInfo.outputPath('hive-config.json');
  writeFileSync(configPath, JSON.stringify({ version: 2, projects: [], clis: { codex: { command: realCodex } } }));
  // Never the real ~/.codex: Codex writes only here.
  const codexHome = testInfo.outputPath('codex-home');
  mkdirSync(codexHome, { recursive: true });
  const configToml = join(codexHome, 'config.toml');

  const app = await launchHive({
    userDataDir: testInfo.outputPath('user-data'),
    configPath,
    env: { CODEX_HOME: codexHome },
  });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('nav[aria-label="Places"]');
    await openPane(page, 'Codex');
    const toggle = page.getByRole('switch', { name: "Install HiveTTY's skills into Codex" });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect.poll(() => read(configPath).clis.codex.installSkills).toBe(true);
    await expect(page.getByText(/^Installed as hive@hivetty \S+\+[0-9a-f]{8}$/)).toBeVisible({ timeout: 60_000 });
    expect(readFileSync(configToml, 'utf8')).toContain('[plugins."hive@hivetty"]');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.screenshot({ path: testInfo.outputPath('codex-plugin-on.png') });

    await toggle.click();
    await expect.poll(() => read(configPath).clis.codex.installSkills).toBeUndefined();
    await expect(page.getByText(/^Installed as hive@hivetty/)).toBeHidden({ timeout: 60_000 });
    await expect.poll(() => readFileSync(configToml, 'utf8')).not.toContain('hivetty');
    await page.screenshot({ path: testInfo.outputPath('codex-plugin-off.png') });
  } finally {
    await app.close();
  }
});

test('skip permission prompts asks, then writes clis.<id>.skipPermissions, and off deletes it', async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  writeFileSync(configPath, JSON.stringify({ version: 2, projects: [] }));

  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('nav[aria-label="Places"]');
    for (const [label, id] of [
      ['Codex', 'codex'],
      ['Copilot', 'copilot'],
    ] as const) {
      await openPane(page, label);
      const toggle = page.getByRole('switch', { name: 'Skip permission prompts' });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      // On asks first; nothing is written until the confirm says so.
      const confirm = page.getByRole('alertdialog', { name: 'Skip permission prompts?' });
      await expect(confirm).toBeVisible();
      expect(read(configPath).clis?.[id]?.skipPermissions).toBeUndefined();
      await page.screenshot({ path: testInfo.outputPath(`skip-permissions-confirm-${id}.png`) });
      await confirm.getByRole('button', { name: 'Skip prompts' }).click();
      await expect.poll(() => read(configPath).clis?.[id]?.skipPermissions).toBe(true);
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    }
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.screenshot({ path: testInfo.outputPath('skip-permissions-on.png') });

    await page.getByRole('switch', { name: 'Skip permission prompts' }).click();
    await expect.poll(() => read(configPath).clis.copilot.skipPermissions).toBeUndefined();
    expect(read(configPath).clis.codex.skipPermissions).toBe(true);
  } finally {
    await app.close();
  }
});
