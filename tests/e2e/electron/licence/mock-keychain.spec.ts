import { expect, test } from '@playwright/test';

import { launchHive, writeProjectConfig } from '../fixtures/hive-app';

/**
 * HIVE-270 D2. Everything else in this folder rests on it: safeStorage must work under
 * `--use-mock-keychain` with no Keychain prompt, the same way in every process. A prompt would hang the
 * round trip, so the 10 s timeout is the "no prompt" assertion.
 */
test('safeStorage round-trips under --use-mock-keychain', async ({}, testInfo) => {
  test.setTimeout(30_000);
  const configPath = testInfo.outputPath('hive-config.json');
  writeProjectConfig(configPath, { id: 'licence-e2e', path: testInfo.outputPath() });
  const app = await launchHive({
    userDataDir: testInfo.outputPath('user-data'),
    configPath,
    args: ['--use-mock-keychain'],
  });
  try {
    const result = await Promise.race([
      app.evaluate(({ app: electronApp, safeStorage }) => ({
        mock: electronApp.commandLine.hasSwitch('use-mock-keychain'),
        available: safeStorage.isEncryptionAvailable(),
        back: safeStorage.decryptString(safeStorage.encryptString('hello')),
      })),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Keychain prompt?')), 10_000)),
    ]);
    expect(result).toEqual({ mock: true, available: true, back: 'hello' });
  } finally {
    await app.close();
  }
});
