import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';

import { mainWindow, writeProjectConfig } from '../fixtures/hive-app';
import { expectSignInGate, expectWorkspace, launchLicensed, recordExternal, signInWithBrowser } from '../fixtures/licence';
import { startStubCloud, type StubCloud } from '../fixtures/stub-cloud';

/**
 * Settings sync between two Macs (HIVE-284): two profiles of one account, both live at once against the stub
 * cloud's `/api/sync`. Mac A sets up, Mac B joins, a skill written on A arrives on B byte for byte, and a skill
 * both changed ends as the newer edit on both with the other copy kept. Nothing the stub receives is readable.
 */

const PASSPHRASE = 'correct horse battery staple';
const NOTE = 'skills/e2e-note/SKILL.md';
const NOTE_TEXT = '# e2e note\n\nWritten on Mac A for HIVE-284.\n';
/** A viewport whose overlay is below its two-column breakpoint (36rem of the overlay's own width). */
const NARROW = { width: 600, height: 820 };

interface Mac {
  app: ElectronApplication;
  page: Page;
  hiveDir: string;
}

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

async function launchMac(testInfo: TestInfo, name: string, trial: boolean): Promise<Mac> {
  const configPath = testInfo.outputPath(name, 'hive-config.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeProjectConfig(configPath, { id: `sync-${name}`, path: testInfo.outputPath(name) });
  const app = await launchLicensed({ stub, configPath, userDataDir: testInfo.outputPath(name, 'user-data') });
  try {
    const page = await mainWindow(app);
    const opened = await recordExternal(app);
    await expectSignInGate(page);
    await signInWithBrowser(app, page, opened);
    if (trial) await page.getByRole('button', { name: 'Start 14-day free trial' }).click();
    await expectWorkspace(page);
    return { app, page, hiveDir: dirname(configPath) };
  } catch (cause) {
    await app.close().catch(() => undefined);
    throw cause;
  }
}

async function openSyncTab(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Account/ }).click();
  await page.getByRole('menuitem', { name: 'Account center' }).click();
  await page.getByRole('tab', { name: 'Sync' }).click();
}

const panel = (page: Page) => page.getByRole('tabpanel', { name: 'Sync' });

/** Press Sync now until `done` holds: a press during a run queues one more, never a second at once. */
async function syncUntil(page: Page, done: () => boolean | Promise<boolean>): Promise<void> {
  await expect
    .poll(
      async () => {
        await panel(page).getByRole('button', { name: 'Sync now' }).click();
        return done();
      },
      { timeout: 30_000, intervals: [750] },
    )
    .toBe(true);
}

const read = (mac: Mac, rel: string): string | null => {
  try {
    return readFileSync(join(mac.hiveDir, rel), 'utf8');
  } catch {
    return null;
  }
};

const write = (mac: Mac, rel: string, text: string, mtimeS?: number): void => {
  const full = join(mac.hiveDir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  if (mtimeS !== undefined) utimesSync(full, mtimeS, mtimeS);
};

const syncPuts = (): number => stub.calls.filter((call) => call.method === 'PUT' && call.path === '/api/sync').length;

async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.evaluate((mode) => {
    const stored = JSON.parse(localStorage.getItem('hive.appearance') ?? '{"version":4,"state":{}}') as {
      version: number;
      state: object;
    };
    localStorage.setItem('hive.appearance', JSON.stringify({ ...stored, state: { ...stored.state, theme: mode } }));
  }, theme);
  await page.reload();
  await expectWorkspace(page);
}

/**
 * The PR's screenshots of one state, in dark and light, at the default size and below the overlay's two-column
 * breakpoint. `prepare` puts the tab back in that state after the reload a theme switch needs.
 */
async function shoot(mac: Mac, testInfo: TestInfo, state: string, prepare: () => Promise<void>): Promise<void> {
  const [width, height] = await mac.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.getURL().includes('splash.html'));
    return win?.getContentSize() ?? [1440, 900];
  });
  const wide = { width: width ?? 1440, height: height ?? 900 };
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(mac.page, theme);
    await openSyncTab(mac.page);
    await prepare();
    await mac.page.screenshot({ path: testInfo.outputPath('shots', `sync-${state}-${theme}-default.png`) });
    /*
      The window cannot be made narrower than MIN_WINDOW_SIZE (1100px), which keeps the overlay above its 36rem
      breakpoint; the viewport is emulated instead, as `agents.spec.ts` does, so the one-column layout shows.
    */
    await mac.page.setViewportSize(NARROW);
    await expect(mac.page.getByRole('navigation', { name: 'Settings sections' })).toBeHidden();
    await expect(panel(mac.page)).toBeVisible();
    // Above the stage floor (520px beside the activity bar), so nothing scrolls sideways or is cut off.
    expect(await mac.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mac.page.screenshot({ path: testInfo.outputPath('shots', `sync-${state}-${theme}-narrow.png`) });
    await mac.page.setViewportSize(wide);
  }
  await setTheme(mac.page, 'dark');
  await openSyncTab(mac.page);
}

test('two Macs of one account set up, join and converge on a skill, with the loser kept', async ({}, testInfo) => {
  test.setTimeout(240_000);
  const a = await launchMac(testInfo, 'mac-a', true);
  let b: Mac | null = null;
  try {
    // 1. Mac A sets up sync.
    await openSyncTab(a.page);
    await expect(panel(a.page).getByRole('heading', { name: 'Your setup, on every Mac' })).toBeVisible();
    await shoot(a, testInfo, 'set-up', async () => {
      await expect(panel(a.page).getByRole('heading', { name: 'Your setup, on every Mac' })).toBeVisible();
    });
    await panel(a.page).getByLabel('Sync passphrase').fill(PASSPHRASE);
    await panel(a.page).getByLabel('Type it again').fill(PASSPHRASE);
    await panel(a.page).getByRole('button', { name: 'Turn on sync' }).click();
    await expect(panel(a.page).getByText('Sync is on')).toBeVisible({ timeout: 30_000 });

    // 2. Mac B finds the account syncing; a wrong passphrase is refused, the right one joins.
    b = await launchMac(testInfo, 'mac-b', false);
    const macB = b;
    await openSyncTab(macB.page);
    await expect(panel(macB.page).getByRole('heading', { name: 'This account already syncs' })).toBeVisible();
    const wrong = async (): Promise<void> => {
      await panel(macB.page).getByLabel('Sync passphrase').fill('not the passphrase at all');
      await panel(macB.page).getByRole('button', { name: 'Join sync' }).click();
      await expect(panel(macB.page).getByRole('alert')).toHaveText("That passphrase doesn't open this account's sync.", {
        timeout: 30_000,
      });
    };
    await wrong();
    await shoot(macB, testInfo, 'join-wrong-passphrase', wrong);
    await panel(macB.page).getByLabel('Sync passphrase').fill(PASSPHRASE);
    await panel(macB.page).getByRole('button', { name: 'Join sync' }).click();
    await expect(panel(macB.page).getByText('Sync is on')).toBeVisible({ timeout: 30_000 });

    // 3. A skill written on A reaches B with the same bytes.
    write(a, NOTE, NOTE_TEXT);
    const before = syncPuts();
    await syncUntil(a.page, () => syncPuts() > before);
    await syncUntil(macB.page, () => read(macB, NOTE) === NOTE_TEXT);
    expect(readFileSync(join(macB.hiveDir, NOTE)).equals(readFileSync(join(a.hiveDir, NOTE)))).toBe(true);

    // 4. Both change it, B last: B's newer edit wins on both, and A keeps its own copy.
    const putsBeforeB = syncPuts();
    write(macB, NOTE, '# e2e note\n\nEdited on Mac B, last.\n', 2_000_000_000);
    await syncUntil(macB.page, () => syncPuts() > putsBeforeB);
    write(a, NOTE, '# e2e note\n\nEdited on Mac A, earlier.\n', 1_900_000_000);
    await syncUntil(a.page, () => read(a, NOTE) === '# e2e note\n\nEdited on Mac B, last.\n');
    await syncUntil(macB.page, () => read(macB, NOTE) === '# e2e note\n\nEdited on Mac B, last.\n');
    await expect(panel(a.page).getByText('1 conflict kept')).toBeVisible({ timeout: 30_000 });
    await expect(panel(a.page).getByText(/skills\/e2e-note\/SKILL\.md/)).toBeVisible();

    // 5. Nothing the cloud received holds the skill's text in clear.
    const bodies = stub.calls.filter((call) => call.method === 'PUT' && call.path === '/api/sync').map((call) => JSON.stringify(call.body));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain('e2e note');
      expect(body).not.toContain('Edited on Mac');
    }

    await shoot(a, testInfo, 'on-with-conflict', async () => {
      await expect(panel(a.page).getByText('1 conflict kept')).toBeVisible({ timeout: 30_000 });
    });
  } finally {
    await b?.app.close().catch(() => undefined);
    await a.app.close().catch(() => undefined);
  }
});
