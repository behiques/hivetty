// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CH } from '../../../../electron/shared/ipc-contract';
import { ACCOUNT_CALLS, resetLicence, startLicence } from '../../../../electron/main/licence';

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
  decryptString: (cipher: Buffer) => cipher.toString('utf8'),
};

describe('licence composition', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-licence-'));
  });
  afterEach(() => {
    resetLicence();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers signed-out and refuses sign-in before it starts', async () => {
    expect(ACCOUNT_CALLS[CH.accountState]()).toEqual({ kind: 'signed-out' });
    await expect(ACCOUNT_CALLS[CH.accountSignIn]()).resolves.toEqual({ error: expect.any(String) });
    expect(() => ACCOUNT_CALLS[CH.accountCancel]()).not.toThrow();
    await expect(ACCOUNT_CALLS[CH.accountSignOut]()).resolves.toBeUndefined();
  });

  it('opens the resolved cloud with the build scheme and broadcasts every change', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal,
      env: { HIVETTY_CLOUD_URL: 'http://127.0.0.1:4010' },
      fetch: vi.fn(),
      broadcast,
    });

    await expect(ACCOUNT_CALLS[CH.accountSignIn]()).resolves.toEqual({ ok: true });

    const url = new URL(openExternal.mock.calls[0]![0] as string);
    expect(url.origin).toBe('http://127.0.0.1:4010');
    expect(url.searchParams.get('redirect_uri')).toBe('hivetty-dev://auth/callback');
    expect(broadcast).toHaveBeenCalledWith({ kind: 'signing-in' });
    expect(ACCOUNT_CALLS[CH.accountState]()).toEqual({ kind: 'signing-in' });
    ACCOUNT_CALLS[CH.accountCancel]();
    expect(ACCOUNT_CALLS[CH.accountState]()).toEqual({ kind: 'signed-out' });
  });

  it('prefers account.cloudUrl', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    startLicence({
      app: { isPackaged: true, getPath: () => dir },
      safeStorage,
      openExternal,
      cloudUrl: 'https://hive.acme.test',
      env: {},
      fetch: vi.fn(),
      broadcast: vi.fn(),
    });
    await ACCOUNT_CALLS[CH.accountSignIn]();
    expect(new URL(openExternal.mock.calls[0]![0] as string).origin).toBe('https://hive.acme.test');
  });
});
