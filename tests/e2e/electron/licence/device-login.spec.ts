import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { runHiveCli } from '../fixtures/hive-app';
import { licenceConfig } from '../fixtures/licence';
import { startStubCloud, USER_CODE, type StubCloud } from '../fixtures/stub-cloud';

let stub: StubCloud;
test.beforeEach(async () => {
  stub = await startStubCloud();
});
test.afterEach(async () => {
  await stub.close();
});

const login = (stub: StubCloud, dirs: { configPath: string; userDataDir: string }, extra: string[] = []) =>
  runHiveCli({ args: ['--login', ...extra, '--use-mock-keychain'], ...dirs, env: stub.env });

/*
  `setPlan('team')` makes the lease call after approval succeed, so `· plan team` prints. Approving before the
  spawn is deliberate: the first poll returns the tokens.
*/

test('--login: approved exits 0, prints the code and the plan, writes account.bin', async ({}, testInfo) => {
  stub.controls.setPlan('team');
  stub.controls.approveDeviceCode();
  const dirs = licenceConfig(testInfo);
  const { code, stdout } = await login(stub, dirs);
  expect(code).toBe(0);
  expect(stdout).toContain(USER_CODE);
  expect(stdout).toMatch(/Signed in as ada@example\.com on .+ · plan team/);
  expect(existsSync(join(dirs.userDataDir, 'account.bin'))).toBe(true);
});

test('--login: denied exits 1', async ({}, testInfo) => {
  stub.controls.denyDeviceCode();
  const { code } = await login(stub, licenceConfig(testInfo));
  expect(code).toBe(1);
});

test('--login: a failing /device/code exits 2', async ({}, testInfo) => {
  stub.controls.failDeviceCode();
  const { code } = await login(stub, licenceConfig(testInfo));
  expect(code).toBe(2);
});

test('--login --force sends the stored device_id', async ({}, testInfo) => {
  stub.controls.setPlan('team');
  stub.controls.approveDeviceCode();
  const dirs = licenceConfig(testInfo);
  expect((await login(stub, dirs)).code).toBe(0);
  expect((await login(stub, dirs, ['--force'])).code).toBe(0);
  const codeCalls = stub.calls.filter((call) => call.path === '/api/oauth/device/code');
  expect(codeCalls).toHaveLength(2);
  // The first login has no device yet, and the forced one sends the id the first was given.
  expect(codeCalls[0]?.body.device_id).toBeUndefined();
  expect(codeCalls[1]?.body.device_id).toMatch(/^dev-/);
});
