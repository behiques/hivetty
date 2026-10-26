import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { goToPlace } from '../fixtures/places';

import { launchHive } from './fixtures/hive-app';

/**
 * Settings › CLIs, driven through the real app (HIVE-341).
 *
 * The unit suite proves the parser, the guard, the setter and the card against fakes. This proves
 * the card's write reaches the file, and that the next wake reads it: the model lands on the argv
 * of a run whose `AGENT.md` names none, and turning Claude off refuses the run with its reason.
 *
 * `HIVE_CONFIG_PATH` points at a scratch file, so nothing here touches `~/.hivetty/config.json`.
 */

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

const openClis = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'CLIs' })
    .click();
  await expect(page.getByRole('heading', { name: 'CLIs', level: 2 })).toBeVisible();
};

test('the card writes the file, and off disables the defaults', async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  writeFileSync(configPath, JSON.stringify({ version: 2, projects: [] }));

  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('nav[aria-label="Places"]');
    await openClis(page);

    const model = page.getByRole('combobox', { name: 'Model' });
    await expect(model).toHaveValue('');
    await model.selectOption('haiku');
    await expect.poll(() => read(configPath).clis?.['claude-code']?.agents?.model).toBe('haiku');
    await page.screenshot({ path: testInfo.outputPath('clis-on.png') });

    await page.getByRole('switch', { name: 'Enabled for agents' }).click();
    await expect.poll(() => read(configPath).clis['claude-code'].agents.enabled).toBe(false);
    await expect(model).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Enabled for agents' })).toHaveAttribute(
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
      page.getByText(/claude-code is turned off for agents in Settings › CLIs/).first(),
    ).toBeVisible({ timeout: 30_000 });
    expect(existsSync(argvFile)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('clis-refused.png') });
  } finally {
    await app.close();
  }
});
