import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { mainWindow } from '../fixtures/hive-app';
import {
  expectSignInGate,
  expectWorkspace,
  launchLicensed,
  recordExternal,
  signedIn,
  signInWithBrowser,
} from '../fixtures/licence';
import { startStubCloud, type StubCloud, type StubOrg } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

/**
 * HIVE-291: Personal (Solo) and Acme (Team). The stub leases the asked org when it seats the caller, else the first
 * seated one, so Personal is the lease until Acme is asked for. `team.ledger` is the Team-only feature.
 */
const PERSONAL: StubOrg = {
  id: 'org-personal',
  name: 'Personal',
  role: 'Owner',
  seat: true,
  plan: 'solo',
  status: 'active',
  personal: true,
};
const ACME: StubOrg = {
  id: 'org-acme',
  name: 'Acme',
  role: 'Member',
  seat: true,
  plan: 'team',
  status: 'active',
  personal: false,
};

const features = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const state = await window.hive!.licence.state();
    return state.kind === 'licensed' || state.kind === 'grace' ? state.features : [];
  });
const leases = (cloud: StubCloud) => cloud.calls.filter((call) => call.path === '/api/lease');

async function pick(page: Page, org: RegExp): Promise<void> {
  await page.getByRole('button', { name: /^Account/ }).click();
  await page.getByRole('menuitemcheckbox', { name: org }).click();
}

test('switching to Acme leases Team (team.ledger); back to Personal leases Solo', async ({}, testInfo) => {
  stub.controls.setOrgs([PERSONAL, ACME]);
  const { app, page } = await signedIn({ stub, testInfo, trial: false });
  try {
    await expect.poll(() => features(page)).not.toContain('team.ledger');
    await pick(page, /^Acme/);
    await expect.poll(() => features(page)).toContain('team.ledger');
    expect(leases(stub).at(-1)?.body.org).toBe('org-acme');
    await pick(page, /^Personal/);
    await expect.poll(() => features(page)).not.toContain('team.ledger');
    expect(leases(stub).at(-1)?.body.org).toBe('org-personal');
  } finally {
    await app.close();
  }
});

test('Acme with no seat: the no-seat line, and the lease stays Personal', async ({}, testInfo) => {
  stub.controls.setOrgs([PERSONAL, { ...ACME, seat: false }]);
  const { app, page } = await signedIn({ stub, testInfo, trial: false });
  try {
    await pick(page, /^Acme/);
    await expect.poll(() => leases(stub).at(-1)?.body.org).toBe('org-acme');
    await page.getByRole('button', { name: /^Account/ }).click();
    await expect(page.getByText('No seat in Acme, using Personal')).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: /^Personal/ })).toHaveAttribute('aria-checked', 'true');
    expect(await features(page)).not.toContain('team.ledger');
  } finally {
    await app.close();
  }
});

test('the choice survives a relaunch, and sign-out forgets it', async ({}, testInfo) => {
  stub.controls.setOrgs([PERSONAL, ACME]);
  const first = await signedIn({ stub, testInfo, trial: false });
  try {
    await pick(first.page, /^Acme/);
    await expect.poll(() => features(first.page)).toContain('team.ledger');
  } finally {
    await first.app.close();
  }

  const before = leases(stub).length;
  const app = await launchLicensed({ stub, configPath: first.configPath, userDataDir: first.userDataDir });
  try {
    const page = await mainWindow(app);
    const opened = await recordExternal(app);
    await expectWorkspace(page);
    await expect.poll(() => leases(stub).slice(before)[0]?.body.org).toBe('org-acme');
    await expect.poll(() => features(page)).toContain('team.ledger');

    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page
      .getByRole('dialog', { name: 'Sign out of HiveTTY Pro?' })
      .getByRole('button', { name: 'Sign out' })
      .click();
    await expectSignInGate(page);
    await expect.poll(() => existsSync(join(first.userDataDir, 'account.bin'))).toBe(false);

    const signedOut = leases(stub).length;
    await signInWithBrowser(app, page, opened);
    await expectWorkspace(page);
    await expect.poll(() => leases(stub).length).toBeGreaterThan(signedOut);
    expect(leases(stub).slice(signedOut).every((call) => call.body.org === undefined)).toBe(true);
    await expect.poll(() => features(page)).not.toContain('team.ledger');
  } finally {
    await app.close();
  }
});
