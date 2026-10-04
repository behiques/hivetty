import { execFileSync } from 'node:child_process';

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';

import { launchHive, writeProjectConfig } from './fixtures/hive-app';

/**
 * The session header keeps the header's metrics, and gives way in order as the
 * stage narrows (HIVE-213).
 *
 * Electron rather than the web project: the browser target cannot open a
 * session, so it never draws a session header. The stub `claude` never prints a
 * status line either, so the metrics are sent on `session:metrics`, the channel
 * the main process forwards the hooks receiver's `/statusline` payload on. The
 * renderer cannot tell the two apart.
 *
 * happy-dom does no layout, so this is where the container queries are proved:
 * at 1440px everything fits; at 1200px (a ~790px stage) the resets give way to
 * `5h` / `wk` and the title column truncates, and the three percentages and
 * the status word stay; with the session panel open beside it, the word goes too.
 *
 * Measured here with this label, the header's content box needs about 861px
 * for the resets, hence 880px. The word's breakpoint is 700px of content box,
 * below the ~750px a 790px stage leaves after `px-5`: at 760px the word was
 * already hidden at 1200px, and the assertion here could not see it, because
 * Playwright counts `sr-only`'s 1px box as visible (HIVE-219).
 */
const PROJECT = 'nova-web';
/** Long enough that `nova-web · <branch>` overflows the title column at 790px of stage. */
const LONG_BRANCH = 'feat/a-branch-name-long-enough-to-truncate-the-title-column';

/**
 * A scratch repository on {@link LONG_BRANCH}, mapped as the project.
 *
 * Not this checkout: the subtitle reads the session's live branch, so mapping
 * the repository the suite runs from made the truncation pass on a long
 * feature branch and fail on `main` or a detached HEAD (HIVE-219).
 */
function longBranchRepo(dir: string): string {
  execFileSync('git', ['init', '-q', '-b', LONG_BRANCH, dir]);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'init'], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Hive',
      GIT_AUTHOR_EMAIL: 'hive@example.com',
      GIT_COMMITTER_NAME: 'Hive',
      GIT_COMMITTER_EMAIL: 'hive@example.com',
    },
  });
  return dir;
}

/**
 * Seed the session panel closed before the first frame that matters: the
 * widths below are the stage beside the list panel alone (about 1,030px at
 * 1440 and 790px at 1200). Round two is the default layout (HIVE-213).
 */
async function closeSessionPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const raw = localStorage.getItem('hive.appearance');
    const stored = raw === null ? { version: 3, state: {} } : (JSON.parse(raw) as { version: number; state: object });
    localStorage.setItem(
      'hive.appearance',
      JSON.stringify({ ...stored, state: { ...stored.state, sessionPanelOpen: false } }),
    );
  });
  await page.reload();
  await page.waitForSelector('nav[aria-label="Places"]');
}

/** Start a session from the filtered Overmind and answer with its id, as `session-panel.spec.ts` does. */
async function startRoundTwoSession(page: Page): Promise<string> {
  await page
    .getByRole('navigation', { name: 'Places' })
    .getByRole('button', { name: 'Sessions', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'Sessions list' })
    .getByRole('button', { name: new RegExp(`^${PROJECT}`) })
    .click();
  await page
    .getByRole('main')
    .getByRole('button', { name: `New session in ${PROJECT}`, exact: true })
    .click();
  const terminal = page.locator('[data-terminal-id^="sess-"]').last();
  await expect(terminal).toBeVisible();
  const id = await terminal.getAttribute('data-terminal-id');
  if (id === null) throw new Error('the spawned session has no terminal id');
  return id;
}

async function resizeTo(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, w: number) =>
      BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: w, height: 900 }),
    width,
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width);
}

/**
 * Whether the status word is drawn, rather than kept for a screen reader.
 * Not `toBeVisible()`: `sr-only` leaves a 1px box, which Playwright calls visible.
 */
async function wordDrawn(header: Locator): Promise<boolean> {
  return header
    .getByTestId('session-status')
    .locator('[data-word]')
    .evaluate((el) => getComputedStyle(el).position !== 'absolute' && el.getBoundingClientRect().width > 1);
}

/** What the receiver would forward for a session that has reported every number. */
async function stageMetrics(app: ElectronApplication, entityId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('session:metrics', payload);
    },
    {
      entityId,
      metrics: {
        model: 'Opus 4.5',
        effort: 'high',
        contextPct: 46,
        contextWindow: 1_000_000,
        fiveHourPct: 12,
        fiveHourResetsAt: now + 3600,
        sevenDayPct: 63,
        sevenDayResetsAt: now + 4 * 86400,
      },
    },
  );
}

test('at 1440px the stats row is whole; at 1200px resets give way and the title truncates', async ({}, testInfo) => {
  const configPath = testInfo.outputPath('hive-config.json');
  writeProjectConfig(configPath, { id: PROJECT, path: longBranchRepo(testInfo.outputPath('repo')) });
  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await closeSessionPanel(page);
    await resizeTo(app, page, 1440);

    const id = await startRoundTwoSession(page);
    const header = page.getByTestId('session-header');
    await expect(header).toBeVisible();
    await stageMetrics(app, id);

    const chip = header.getByTestId('model-chip');
    await expect(chip.getByText(/%$/)).toHaveCount(3);
    await expect(chip.locator('[data-detail="long"]').first()).toBeVisible();
    await expect(chip.locator('[data-detail="short"]').first()).toBeHidden();
    expect(await chip.evaluate((el) => el.scrollWidth === el.clientWidth)).toBe(true);

    await resizeTo(app, page, 1200);
    await expect(chip.locator('[data-detail="long"]').first()).toBeHidden();
    await expect(chip.locator('[data-detail="short"]').first()).toBeVisible();
    await expect(chip.getByText(/%$/)).toHaveCount(3);
    for (const pct of await chip.getByText(/%$/).all()) await expect(pct).toBeVisible();
    // The status word is the last to go, and 1200px is not that narrow.
    expect(await wordDrawn(header)).toBe(true);
    const truncated = await header
      .locator('.truncate')
      .evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth));
    expect(truncated).toBe(true);

    /*
      Narrower than the word's breakpoint: the session panel open beside it.
      Not a narrower window: below 1200px the list panel folds away and the
      stage grows. The dot stays and keeps the word in its title.
    */
    await page
      .getByRole('complementary', { name: 'Session panel' })
      .getByRole('button', { name: 'Files' })
      .click();
    await expect(page.getByRole('tablist')).toBeVisible();
    await expect.poll(() => wordDrawn(header)).toBe(false);
    await expect(header.getByTestId('session-status')).toHaveAttribute('title', /\S/);
  } finally {
    await app.close();
  }
});
