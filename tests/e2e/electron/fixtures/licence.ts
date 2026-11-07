import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';

import { launchHive, mainWindow, writeProjectConfig } from './hive-app';
import type { StubCloud } from './stub-cloud';

/** HIVE-270. Launch, sign-in and gate helpers for `tests/e2e/electron/licence/`. */

export function licenceConfig(
  testInfo: TestInfo,
  options: { claudeCommand?: string } = {},
): { configPath: string; userDataDir: string } {
  const configPath = testInfo.outputPath('hive-config.json');
  writeProjectConfig(configPath, {
    id: 'licence-e2e',
    path: testInfo.outputPath(),
    ...(options.claudeCommand === undefined ? {} : { claudeCommand: options.claudeCommand }),
  });
  return { configPath, userDataDir: testInfo.outputPath('user-data') };
}

export interface Counter {
  script: string;
  pidFile: string;
  logFile: string;
}

/**
 * The ticket's suspension probe: a number every 100 ms, to the PTY and to a log, with its own pid written first.
 * The gate covers the terminal, so the files are the evidence (spec D5). It answers `--version` like a real
 * CLI, because CLI detection runs `<claudeCommand> --version` (HIVE-375).
 */
export function writeCounter(testInfo: TestInfo): Counter {
  const counter = {
    script: testInfo.outputPath('counter.sh'),
    pidFile: testInfo.outputPath('counter.pid'),
    logFile: testInfo.outputPath('counter.log'),
  };
  writeFileSync(
    counter.script,
    `#!/bin/sh\n[ "$1" = --version ] && { echo 'stub 1.0.0'; exit 0; }\n` +
      `echo $$ > '${counter.pidFile}'\ni=0\n` +
      `while :; do i=$((i+1)); echo "count $i"; echo "$i" >> '${counter.logFile}'; sleep 0.1; done\n`,
  );
  chmodSync(counter.script, 0o755);
  return counter;
}

export const counterPid = (counter: Counter): number | null =>
  existsSync(counter.pidFile) ? Number(readFileSync(counter.pidFile, 'utf8').trim()) : null;

export const counterLines = (counter: Counter): number[] =>
  existsSync(counter.logFile) ? readFileSync(counter.logFile, 'utf8').split('\n').filter(Boolean).map(Number) : [];

/** Suspended means `ps` reports the `T` state (plan ruling 3). */
export function isStopped(pid: number): boolean {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).includes('T');
  } catch {
    return false;
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const licenceKind = (page: Page): Promise<string> =>
  page.evaluate(async () => (await window.hive!.licence.state()).kind);

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
export async function signedIn(input: {
  stub: StubCloud;
  testInfo: TestInfo;
  trial?: boolean;
  claudeCommand?: string;
}): Promise<{
  app: ElectronApplication;
  page: Page;
  opened: () => Promise<string[]>;
  configPath: string;
  userDataDir: string;
}> {
  const { configPath, userDataDir } = licenceConfig(input.testInfo, {
    ...(input.claudeCommand === undefined ? {} : { claudeCommand: input.claudeCommand }),
  });
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
