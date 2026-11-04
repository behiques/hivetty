import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { launchHive } from './fixtures/hive-app';
import { openPane, readConfig } from './fixtures/settings';

/**
 * Every field HIVE-374 to HIVE-380 moved still writes the config key it wrote before (HIVE-60): one test per group,
 * through the real pane, read back from the `HIVE_CONFIG_PATH` sandbox.
 *
 * The fields already proven this way elsewhere are not repeated: `agentsDefaultCli` (clis-settings), the ticket
 * workflow (jira-settings), `server.enabled` and the container alias and bind (advanced-settings), and the per-project
 * runtime overrides (runtime-settings).
 */

async function launch(
  outputPath: (name: string) => string,
): Promise<{ app: ElectronApplication; page: Page; configPath: string }> {
  const configPath = outputPath('hive-config.json');
  const repo = outputPath('nova-web');
  mkdirSync(repo, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      version: 2,
      shell: '/bin/sh',
      projects: [{ id: 'nova-web', name: 'nova-web', key: 'nova', path: repo }],
    }),
  );
  const app = await launchHive({ userDataDir: outputPath('user-data'), configPath });
  const page = await app.firstWindow();
  await page.waitForSelector('nav[aria-label="Places"]');
  return { app, page, configPath };
}

/** Types into a settings text field and commits it the way a person does, by leaving it. */
async function commit(page: Page, label: string | RegExp, value: string): Promise<void> {
  const field = page.getByLabel(label, { exact: typeof label === 'string' });
  await field.fill(value);
  await field.blur();
}

test('Harnesses: each CLI page and Overview write their keys', async ({}, testInfo) => {
  const { app, page, configPath } = await launch((name) => testInfo.outputPath(name));

  try {
    // Claude Code's command is the global claudeCommand (HIVE-376 D10).
    await openPane(page, 'claude-code');
    await commit(page, 'Command', 'claude --verbose');
    await expect.poll(() => readConfig(configPath).claudeCommand).toBe('claude --verbose');

    // New sessions: the model and effort steppers.
    await page.getByRole('radiogroup', { name: 'model' }).getByRole('radio', { name: 'sonnet' }).click();
    await expect.poll(() => readConfig(configPath).clis?.['claude-code']?.sessionModel).toBe('sonnet');
    await page.getByRole('radiogroup', { name: 'thinking effort' }).getByRole('radio', { name: 'max' }).click();
    await expect.poll(() => readConfig(configPath).clis['claude-code'].sessionEffort).toBe('max');

    // Codex's and Copilot's commands are clis.<id>.command; empty removes the key, never writes "".
    for (const cli of ['codex', 'copilot'] as const) {
      await openPane(page, cli);
      await commit(page, 'Command', `${cli}-nightly`);
      await expect.poll(() => readConfig(configPath).clis?.[cli]?.command).toBe(`${cli}-nightly`);
      await commit(page, 'Command', '');
      await expect.poll(() => 'command' in (readConfig(configPath).clis[cli] ?? {})).toBe(false);
    }
    // The global command was never restated by a per-CLI write.
    expect(readConfig(configPath).claudeCommand).toBe('claude --verbose');

    // Overview: the session default and the per-CLI sessions switch (config:set-cli-sessions).
    await openPane(page, 'harnesses-overview');
    await page.getByRole('radio', { name: 'Codex is the default for new sessions' }).check();
    await expect.poll(() => readConfig(configPath).sessionsDefaultCli).toBe('codex');
    await page.getByRole('switch', { name: 'Use Copilot for sessions' }).click();
    await expect.poll(() => readConfig(configPath).clis?.copilot?.sessions).toBe(false);
  } finally {
    await app.close();
  }
});

test('Workspace: a project default CLI writes project.harness, and the global default removes it', async ({}, testInfo) => {
  const { app, page, configPath } = await launch((name) => testInfo.outputPath(name));
  const harness = () => readConfig(configPath).projects[0] as Record<string, unknown>;

  try {
    await openPane(page, 'projects');
    await page.getByRole('button', { name: 'Actions for nova-web' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Codex' }).click();
    await expect.poll(() => harness().harness).toBe('codex');

    await page.getByRole('button', { name: 'Actions for nova-web' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemcheckbox', { name: 'Use the global default' }).click();
    await expect.poll(() => 'harness' in harness()).toBe(false);
    // Spread, never rebuilt: the rest of the entry is the seed's.
    expect(harness()).toMatchObject({ id: 'nova-web', name: 'nova-web', key: 'nova' });
  } finally {
    await app.close();
  }
});

test('Machines: the attach address writes remote.host and remote.port without dialling', async ({}, testInfo) => {
  const { app, page, configPath } = await launch((name) => testInfo.outputPath(name));

  try {
    await openPane(page, 'server-mode');
    await page.getByRole('switch', { name: 'Attach to a server' }).click();

    await commit(page, /^server address/i, '100.100.100.100');
    await expect.poll(() => readConfig(configPath).remote?.host).toBe('100.100.100.100');
    await commit(page, /^port$/i, '7500');
    await expect.poll(() => readConfig(configPath).remote?.port).toBe(7500);

    // A field commit is a write, never an attach: only the Attach button asks for 'remote' (HIVE-144 I6).
    expect(readConfig(configPath).remote.mode).not.toBe('remote');
  } finally {
    await app.close();
  }
});
