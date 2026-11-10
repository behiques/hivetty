import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  HOOK_HEADER_SESSION,
  HOOK_HEADER_TOKEN,
} from '../../../electron/shared/hook-contract';
import { LEDGER_POST_PATH } from '../../../electron/shared/ledger-contract';
import { BOOT, goToOvermind, goToPlace, openConsole, overmindNewSession } from '../fixtures/places';

import { mainWindow, setContentSize } from './fixtures/hive-app';
import { expectSignInGate, expectWorkspace, launchLicensed, recordExternal, signInWithBrowser } from './fixtures/licence';
import { startStubCloud } from './fixtures/stub-cloud';

/**
 * Retakes the guide screenshots (HIVE-213). Not part of `test:e2e`: skipped unless
 * HIVE_GUIDE_SHOTS=1 (`pnpm docs:shots`, after `desktop:build`). Fixed 1440×900, dark theme
 * (the default), light for shot 22. Shot 12 is the theme gallery.
 *
 * Each shot is the state its guide's caption describes, reached the way a person would:
 * through the sign-in gate, the bar, the Overmind and the session panel. The account is the
 * stub cloud's (Ada Lovelace, on a Team trial), so no real name or email reaches an image.
 * The asks in shot 05 are posted from the session's own shell through the receiver, as
 * `ask-card.spec.ts` posts its own. Shot 03 and the README hero start the real `claude` on
 * PATH and ask it a question that needs no tools, so the terminal shows a real answer.
 */
test.skip(process.env['HIVE_GUIDE_SHOTS'] !== '1', 'set HIVE_GUIDE_SHOTS=1 (pnpm docs:shots)');

const REAL_DIRECTORY = join(import.meta.dirname, '../../..');
const OUT = join(REAL_DIRECTORY, 'docs/assets/guide');
const HERO = join(REAL_DIRECTORY, 'docs/assets/screenshot.png');
const SESSION = 'sess-01';
/** The config folder Settings prints in agent and skill paths: neutral, so no home folder reaches an image. */
const SHOT_HOME = '/tmp/hivetty-guide';

const readMarker = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, 'utf8').trim() : null;

async function expectMarker(path: string, contents: string): Promise<void> {
  await expect.poll(() => readMarker(path), { timeout: 15_000 }).toBe(contents);
}

/** Where `name` lives on this machine's PATH, or `null`. */
function onPath(name: string): string | null {
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The CLIs Settings › Harnesses lists, under SHOT_HOME so no home folder reaches an image.
 * `claude` is a stub that marks its own start and answers `--version` as the real one does
 * (CLI detection runs it, HIVE-375); Codex and Copilot are links to the real binaries.
 */
function writeBin(bootstrapMarker: string): Record<string, { command: string }> {
  const bin = join(SHOT_HOME, 'bin');
  mkdirSync(bin, { recursive: true });
  const claude = join(bin, 'claude');
  const realClaude = onPath('claude') ?? 'claude';
  // Exiting non-zero keeps the login shell open (see `hive-app.ts`, STUB_CLAUDE_COMMAND).
  writeFileSync(
    claude,
    `#!/bin/sh\n[ "$1" = --version ] && exec '${realClaude}' --version\nprintf bootstrapped > '${bootstrapMarker}'\nexit 1\n`,
  );
  chmodSync(claude, 0o755);
  const clis: Record<string, { command: string }> = {};
  for (const name of ['codex', 'copilot']) {
    const real = onPath(name);
    if (real === null) continue;
    symlinkSync(real, join(bin, name));
    clis[name] = { command: join(bin, name) };
  }
  return clis;
}

/** Two projects on real directories, and a stub agent that marks its own start. */
function writeConfig(path: string, bootstrapMarker: string): void {
  const clis = writeBin(bootstrapMarker);
  // The projects are a shallow clone of this checkout's main, so Settings › Projects and the
  // session print SHOT_HOME, not a home folder (a link would be resolved back to the real path).
  const novaWeb = join(SHOT_HOME, 'nova-web');
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', 'main', `file://${REAL_DIRECTORY}`, novaWeb]);
  writeFileSync(
    path,
    JSON.stringify({
      version: 2,
      shell: '/bin/sh',
      claudeCommand: join(SHOT_HOME, 'bin', 'claude'),
      clis,
      projects: [
        { id: 'nova-web', name: 'nova-web', path: novaWeb, icon: 'ph-cube' },
        { id: 'hive-docs', name: 'hive-docs', path: join(novaWeb, 'docs'), icon: 'ph-book' },
      ],
    }),
  );
}

/** One authored skill beside the config, for the Skills pane and its editor (shots 14 and 20). */
function writeSkill(configPath: string): void {
  const dir = join(configPath, '..', 'skills', 'standup');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: standup\ndescription: Summarise yesterday\'s commits and open PRs as a standup update.\n' +
      'disable-model-invocation: true\n---\n\n# Standup\n\n1. Read `git log --since=yesterday`.\n' +
      '2. List my open pull requests with `gh pr list --author @me`.\n3. Write three lines: done, next, blocked.\n',
  );
}

/** Type into the session's pty and submit with Enter, as a person at a TUI prompt would. */
async function ask(page: Page, prompt: string): Promise<void> {
  const write = (data: string) =>
    page.evaluate(([sessionId, text]) => window.hive!.pty.write({ sessionId: sessionId!, data: text! }), [SESSION, data]);
  await write(prompt);
  await page.waitForTimeout(400);
  await write('\r');
}

/** Send a line to the session's pty, as a keystroke would. */
async function shell(page: Page, command: string): Promise<void> {
  await page.evaluate(
    ([sessionId, data]) => {
      window.hive!.pty.write({ sessionId: sessionId!, data: data! });
    },
    [SESSION, `${command}\n`],
  );
}

/** The curl the session's own hooks would run, with the HTTP status written to `statusMarker`. */
function postAsk(ask: Record<string, unknown>, statusMarker: string): string {
  return (
    `curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST "$${HOOK_ENV_RECEIVER_URL}${LEDGER_POST_PATH}"` +
    ` -H "${HOOK_HEADER_SESSION}: $${HOOK_ENV_SESSION}"` +
    ` -H "${HOOK_HEADER_TOKEN}: $${HOOK_ENV_TOKEN}"` +
    ` -H "content-type: application/json"` +
    ` --data-binary '${JSON.stringify({ to: 'overmind', kind: 'ask', ...ask })}'` +
    ` > '${statusMarker}'`
  );
}

/**
 * A neutral prompt over `ls`: the shell's own prompt and the commands typed so far would
 * print this machine's name and paths into a published image.
 */
async function cleanScreen(page: Page, marker: string): Promise<void> {
  await shell(page, `PS1='nova-web $ '; clear; ls; printf cleared > '${marker}'`);
  await expectMarker(marker, 'cleared');
  // The terminal draws to a canvas, so there is no text to wait on: give it a frame or two.
  await page.waitForTimeout(500);
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, name) });

test('guide shots', async ({}, testInfo) => {
  test.setTimeout(300_000);
  rmSync(SHOT_HOME, { recursive: true, force: true });
  mkdirSync(SHOT_HOME, { recursive: true });
  const configPath = join(SHOT_HOME, 'config.json');
  const bootstrapMarker = join(SHOT_HOME, 'bootstrap.marker');
  writeConfig(configPath, bootstrapMarker);
  writeSkill(configPath);

  const stub = await startStubCloud();
  stub.controls.setBilling({
    orgId: 'org-ada',
    subscription: {
      plan: 'team',
      status: 'trialing',
      interval: 'month',
      seats: 5,
      renewsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
      provider: 'stripe',
    },
    canManage: true,
    seated: 3,
  });
  const app = await launchLicensed({ stub, userDataDir: testInfo.outputPath('user-data'), configPath });
  try {
    const page = await mainWindow(app);
    await setContentSize(app, 1440, 900);
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1440, 900]);
    const opened = await recordExternal(app);

    // 06: the sign-in gate on first launch.
    await expectSignInGate(page);
    await shot(page, '06-sign-in.png');

    // 07: signed in with no plan yet: the trial offer.
    await signInWithBrowser(app, page, opened);
    const trial = page.getByRole('button', { name: 'Start 14-day free trial' });
    await expect(trial).toBeVisible();
    await shot(page, '07-start-trial.png');
    await trial.click();
    await expectWorkspace(page);
    await page.waitForSelector(BOOT);

    // 01: the Overmind with two projects mapped and nothing running.
    await goToOvermind(page);
    await shot(page, '01-empty-overmind.png');

    // 02: the new-session picker.
    await overmindNewSession(page).click();
    const search = page.getByRole('textbox', { name: 'Search all projects' });
    await expect(search).toBeFocused();
    // With projects mapped the title draws, and the CLI dock under it offers every CLI.
    await expect(page.getByRole('radiogroup', { name: 'cli' }).getByRole('radio')).toHaveCount(3);
    await shot(page, '02-new-session-picker.png');

    // A live session on the stage, the session panel beside it.
    await page.keyboard.type('nova');
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-terminal-id="${SESSION}"]`)).toBeVisible();
    await expectMarker(bootstrapMarker, 'bootstrapped');
    // The stub never reports ready, so lift the boot cover the way a person would: one keystroke.
    await page.keyboard.press('Shift');
    await expect(page.getByText('press any key to watch it boot')).toBeHidden();
    const panel = page.getByRole('complementary', { name: 'Session panel' });
    await expect(panel).toBeVisible();
    await cleanScreen(page, testInfo.outputPath('cleared.marker'));

    // Two asks for the Inbox, posted while the shell is still a shell: a permission request
    // with its scope ladder, and a question.
    const permission = testInfo.outputPath('permission.status');
    const question = testInfo.outputPath('question.status');
    await shell(
      page,
      postAsk(
        { body: 'Allow Bash?', meta: { kind: 'permission', tool: 'Bash', input: { command: 'pnpm test' } } },
        permission,
      ),
    );
    await expectMarker(permission, '200');
    await shell(
      page,
      postAsk({ body: 'Deploy nova-web to staging?', meta: { options: ['Deploy', 'Wait'] } }, question),
    );
    await expectMarker(question, '200');
    await cleanScreen(page, testInfo.outputPath('cleared-again.marker'));

    // 03 and the README's hero: the real `claude` on PATH, asked a question it answers
    // without a tool. The canvas has no text to wait on, so each step gets time to draw.
    await shell(page, 'clear; claude');
    await page.waitForTimeout(8_000);
    // The new folder's trust prompt defaults to No, so step down to Yes; then any first-run
    // notice takes an Enter. With neither showing, the empty prompt ignores both keys.
    await ask(page, '\u001b[B');
    await page.waitForTimeout(3_000);
    await ask(page, '');
    await page.waitForTimeout(3_000);
    await ask(page, 'In two short sentences, what is a pseudo-terminal?');
    await page.waitForTimeout(40_000);
    const pill = page.getByRole('button', { name: /^Inbox, / });
    await expect(pill).toBeVisible();
    await shot(page, '03-session.png');
    await page.screenshot({ path: HERO });

    // 05: the drawer with both cards, which the split pill's Open all opens (HIVE-228).
    await page.getByRole('button', { name: 'Open all' }).click();
    const drawer = page.getByRole('dialog', { name: 'Needs you' });
    await expect(drawer.getByText('Deploy nova-web to staging?')).toBeVisible();
    await shot(page, '05-inbox-asks.png');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    // 04: the Files tab with README.md open in the editor.
    await panel.getByRole('tab', { name: /^Files/ }).click();
    await panel.locator('[data-panel="explorer"]').getByText('README.md', { exact: true }).click();
    // Markdown opens rendered; this shot is of the editor, so ask for the source.
    await page.getByRole('radio', { name: 'Source' }).click();
    await expect(page.locator('.cm-editor')).toBeVisible();
    await shot(page, '04-explorer-editor.png');
    // The tab's × is aria-hidden (the tab strip's keyboard model closes tabs
    // another way), so it has a title and no accessible name.
    await page.locator('[aria-description="Close README.md"]').click();

    // 08: the Overmind with its console open and the help output.
    await openConsole(page);
    await page.getByRole('textbox', { name: 'Overmind command' }).fill('help');
    await page.keyboard.press('Enter');
    await shot(page, '08-overmind-console.png');

    // 09: the Agents place, its lanes in the list panel.
    await goToPlace(page, 'Agents');
    const agents = page.getByRole('region', { name: 'Agents list' });
    await expect(agents).toBeVisible();
    await shot(page, '09-agents-tab.png');

    // 10: one agent's page, on Activity.
    await agents.getByRole('button', { name: /^[a-z][a-z0-9-]*, / }).first().click();
    await expect(page.getByRole('main').getByRole('radio', { name: 'Activity' })).toBeVisible();
    await shot(page, '10-agent-view.png');

    // Settings, from the avatar's menu: signed in, the bar's foot is the account.
    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Settings…' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    const pane = async (name: string): Promise<void> => {
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(300);
    };

    for (const [name, file] of [
      ['Projects', '11-settings-projects.png'],
      ['Editor', '13-settings-editor.png'],
      ['Skills', '14-settings-skills.png'],
      ['Agents', '15-settings-agents.png'],
      ['Integrations', '16-settings-integrations.png'],
      ['Notifications', '17-settings-notifications.png'],
      ['Runtime', '18-settings-runtime.png'],
      ['Overview', '23-settings-harnesses.png'],
    ] as const) {
      await pane(name);
      await shot(page, file);
    }

    // 20: the authored skill open in the Skills pane's editor.
    await pane('Skills');
    await settings.getByRole('button', { name: '/standup' }).click();
    await expect(page.locator('.cm-editor')).toBeVisible();
    await shot(page, '20-skill-editor.png');

    // 21: a shipped agent's form, scrolled to its Runs on group (HIVE-396).
    await pane('Agents');
    await settings.getByRole('button', { name: /^builder/ }).first().click();
    await settings.getByRole('tab', { name: 'Form' }).click();
    await settings.getByText('Runs on', { exact: true }).first().scrollIntoViewIfNeeded();
    await shot(page, '21-agent-form.png');

    // 19: the Account centre on Plan & billing: the trial's plan, seats and licence.
    await settings.getByRole('button', { name: /^Account, / }).click();
    await page.getByRole('tab', { name: 'Plan & billing' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Plan & billing' }).getByText('3 of 5 in use')).toBeVisible();
    await shot(page, '19-account-centre.png');

    // 12: Settings › Appearance, the gallery's nine cards with HiveTTY first and active (HIVE-241).
    await pane('Appearance');
    await expect(page.getByRole('button', { name: 'HiveTTY Built in' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Creep Built in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Beacon Built in' })).toBeVisible();
    await shot(page, '12-settings-appearance.png');

    // 22: Home in the HiveTTY theme's light mode.
    await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Light' }).click();
    await page.keyboard.press('Escape');
    await goToPlace(page, 'Home');
    await shot(page, '22-light-theme.png');
  } finally {
    await app.close();
    await stub.close();
  }
});
