// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CH } from '../../../../electron/shared/ipc-contract';
import {
  ACCOUNT_CALLS,
  LICENCE_CALLS,
  licence,
  onLicenceChange,
  resetLicence,
  startLicence,
} from '../../../../electron/main/licence';
import { ISS, makeSigner, claimsFor } from '../../../support/lease';

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
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
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
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
    });
    await ACCOUNT_CALLS[CH.accountSignIn]();
    expect(new URL(openExternal.mock.calls[0]![0] as string).origin).toBe('https://hive.acme.test');
  });
  it('answers unlicensed before it starts, and refresh is safe', async () => {
    expect(licence()).toEqual({ kind: 'unlicensed' });
    expect(LICENCE_CALLS[CH.licenceState]()).toEqual({ kind: 'unlicensed' });
    await expect(LICENCE_CALLS[CH.licenceRefresh]()).resolves.toEqual({ kind: 'unlicensed' });
    expect(() => LICENCE_CALLS[CH.licenceWatchPurchase](true)).not.toThrow();
  });

  it('starts the licence beside the account, reading <userData>/lease.jws, renewing on wake', () => {
    let wake: (() => void) | undefined;
    const broadcastLicence = vi.fn();
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: {},
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
      broadcast: vi.fn(),
      broadcastLicence,
      onWake: (listener) => {
        wake = listener;
      },
    });
    expect(licence()).toEqual({ kind: 'unlicensed' });
    expect(wake).toBeTypeOf('function');
    expect(() => wake?.()).not.toThrow();
  });

  it('a listener registered before start hears the first change, and so does the window', () => {
    const signer = makeSigner('kid-index');
    writeFileSync(join(dir, 'lease.jws'), signer.sign(claimsFor()));
    const early = vi.fn();
    onLicenceChange(early);
    const broadcastLicence = vi.fn();
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_LEASE_KEYS: JSON.stringify([signer.jwk]), HIVETTY_CLOUD_URL: ISS },
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence,
      onWake: vi.fn(),
    });
    expect(early.mock.calls).toEqual([[{ kind: 'lapsed', reason: 'signed_out' }]]);
    expect(broadcastLicence).toHaveBeenCalledWith({ kind: 'lapsed', reason: 'signed_out' });
    expect(licence()).toEqual({ kind: 'lapsed', reason: 'signed_out' });
  });

  it('resetLicence forgets the listeners and the state', () => {
    const early = vi.fn();
    onLicenceChange(early);
    resetLicence();
    const signer = makeSigner('kid-reset');
    writeFileSync(join(dir, 'lease.jws'), signer.sign(claimsFor()));
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_LEASE_KEYS: JSON.stringify([signer.jwk]), HIVETTY_CLOUD_URL: ISS },
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
    });
    expect(early).not.toHaveBeenCalled();
    resetLicence();
    expect(licence()).toEqual({ kind: 'unlicensed' });
  });
});
