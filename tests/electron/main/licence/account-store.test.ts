// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type AccountSafeStorage,
  createAccountStore,
  type StoredAccount,
} from '../../../../electron/main/licence/account-store';

/** Base64, so plaintext on disk is something this fake can catch (as token-store's test does). */
function fakeSafeStorage(available = true): AccountSafeStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').toString('base64'), 'utf8'),
    decryptString: (cipher) => Buffer.from(cipher.toString('utf8'), 'base64').toString('utf8'),
  };
}

const ACCOUNT: StoredAccount = {
  refreshToken: 'rt-1',
  deviceId: 'dev-1',
  deviceKey: {
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'pub' },
    privateJwk: { kty: 'OKP', crv: 'Ed25519', x: 'pub', d: 'priv' },
  },
  email: 'ada@example.com',
  name: 'Ada',
};

describe('createAccountStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-account-'));
    filePath = join(dir, 'account.bin');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips an account, encrypted, mode 0600', () => {
    const store = createAccountStore({ safeStorage: fakeSafeStorage(), filePath });
    expect(store.write(ACCOUNT)).toBe(true);
    expect(store.read()).toEqual(ACCOUNT);
    expect(readFileSync(filePath, 'utf8')).not.toContain('rt-1');
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('reads null when nothing is stored or encryption is unavailable', () => {
    expect(createAccountStore({ safeStorage: fakeSafeStorage(), filePath }).read()).toBeNull();
    createAccountStore({ safeStorage: fakeSafeStorage(), filePath }).write(ACCOUNT);
    expect(createAccountStore({ safeStorage: fakeSafeStorage(false), filePath }).read()).toBeNull();
  });

  it('refuses to write without encryption and writes nothing', () => {
    const store = createAccountStore({ safeStorage: fakeSafeStorage(false), filePath });
    expect(store.write(ACCOUNT)).toBe(false);
    expect(() => statSync(filePath)).toThrow();
  });

  it('reads null for bytes that do not decrypt or are not an account', () => {
    const safeStorage = fakeSafeStorage();
    const store = createAccountStore({ safeStorage, filePath });
    const shapes: unknown[] = [
      [],
      { ...ACCOUNT, refreshToken: '' },
      { ...ACCOUNT, email: 7 },
      { ...ACCOUNT, deviceKey: { publicJwk: { kty: 'RSA' }, privateJwk: ACCOUNT.deviceKey.privateJwk } },
      { ...ACCOUNT, deviceKey: { publicJwk: ACCOUNT.deviceKey.publicJwk, privateJwk: { kty: 'OKP' } } },
    ];
    for (const shape of shapes) {
      writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(shape)));
      expect(store.read()).toBeNull();
    }
    writeFileSync(filePath, 'not base64 json');
    expect(store.read()).toBeNull();
  });

  it('answers false instead of throwing when the write fails, keeping the old account', () => {
    const safeStorage = fakeSafeStorage();
    const store = createAccountStore({ safeStorage, filePath });
    store.write(ACCOUNT);
    const failing = createAccountStore({
      safeStorage: {
        ...safeStorage,
        encryptString: () => {
          throw new Error('keychain locked');
        },
      },
      filePath,
    });
    expect(failing.write({ ...ACCOUNT, refreshToken: 'rt-2' })).toBe(false);
    expect(store.read()).toEqual(ACCOUNT);
    const unwritable = createAccountStore({ safeStorage, filePath: join(dir, 'missing', 'account.bin') });
    expect(unwritable.write(ACCOUNT)).toBe(false);
  });

  it('tightens an existing file to 0600 and keeps the private key off disk', () => {
    writeFileSync(filePath, 'old', { mode: 0o644 });
    createAccountStore({ safeStorage: fakeSafeStorage(), filePath }).write(ACCOUNT);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(readFileSync(filePath, 'utf8')).not.toContain('priv');
  });

  it('clears idempotently', () => {
    const store = createAccountStore({ safeStorage: fakeSafeStorage(), filePath });
    store.write(ACCOUNT);
    store.clear();
    store.clear();
    expect(store.read()).toBeNull();
  });
});
