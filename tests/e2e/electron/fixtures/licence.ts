import { expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';

import { launchHive, mainWindow, writeProjectConfig } from './hive-app';
import type { StubCloud } from './stub-cloud';

/** HIVE-270. Launch, sign-in and gate helpers for `tests/e2e/electron/licence/`. */

export function licenceConfig(testInfo: TestInfo): { configPath: string; userDataDir: string } {
  const configPath = testInfo.outputPath('hive-config.json');
  writeProjectConfig(configPath, { id: 'licence-e2e', path: testInfo.outputPath() });
  return { configPath, userDataDir: testInfo.outputPath('user-data') };
}

/** The built app against `stub`, with the gate on (D1) and the mock keychain (D2). */
export function launchLicensed(input: {
  stub: StubCloud;
  userDataDir: string;
  configPath: string;
  args?: string[];
}): Promise<ElectronApplication> {
  return launchHive({
    userDataDir: input.userDataDir,
    configPath: input.configPath,
    env: { ...input.stub.env, HIVE_E2E_GATE: '1' },
    args: ['--use-mock-keychain', ...(input.args ?? [])],
  });
}

/** Swap main's `shell.openExternal` for a recorder (D3). Main reads it on every call (`index.ts:151`). */
export async function recordExternal(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as Record<string, unknown>).__licenceOpened = opened;
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });
  return () => app.evaluate(() => [...((globalThis as Record<string, unknown>).__licenceOpened as string[])]);
}

/** Click "Sign in with browser", then come back the way the browser would: `open-url` with the request's `state`. */
export async function signInWithBrowser(
  app: ElectronApplication,
  page: Page,
  opened: () => Promise<string[]>,
): Promise<void> {
  await page.getByRole('button', { name: 'Sign in with browser' }).click();
  let authorize = '';
  await expect
    .poll(async () => {
      authorize = (await opened()).find((url) => url.includes('/api/oauth/authorize')) ?? '';
      return authorize;
    })
    .not.toBe('');
  const params = new URL(authorize).searchParams;
  const callback = `${params.get('redirect_uri') ?? ''}?code=stub-code&state=${params.get('state') ?? ''}`;
  await app.evaluate(({ app: electronApp }, link) => {
    electronApp.emit('open-url', { preventDefault: () => undefined }, link);
  }, callback);
}

/** The account menu is mounted only behind an open gate. */
export async function expectWorkspace(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible({ timeout: 15_000 });
}

export async function expectSignInGate(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Sign in to HiveTTY Pro' })).toBeVisible({ timeout: 15_000 });
}

/** `licence:refresh` through the bridge, which is what the ticket's "then licence:refresh" means. */
export async function refreshLicence(page: Page): Promise<void> {
  await page.evaluate(() => window.hive!.licence.refresh());
}

/** Signed in and on the workspace: with a trial by default, or on whatever plan the stub already holds. */
export async function signedIn(input: { stub: StubCloud; testInfo: TestInfo; trial?: boolean }): Promise<{
  app: ElectronApplication;
  page: Page;
  opened: () => Promise<string[]>;
  configPath: string;
  userDataDir: string;
}> {
  const { configPath, userDataDir } = licenceConfig(input.testInfo);
  const app = await launchLicensed({ stub: input.stub, configPath, userDataDir });
  // The caller's try/finally opens only after this returns, so a failed step closes the app here.
  try {
    const page = await mainWindow(app);
    const opened = await recordExternal(app);
    await expectSignInGate(page);
    await signInWithBrowser(app, page, opened);
    if (input.trial ?? true) await page.getByRole('button', { name: 'Start 14-day free trial' }).click();
    await expectWorkspace(page);
    return { app, page, opened, configPath, userDataDir };
  } catch (cause) {
    await app.close().catch(() => undefined);
    throw cause;
  }
}
