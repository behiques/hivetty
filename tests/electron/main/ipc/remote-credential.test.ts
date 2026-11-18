// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The attach credential lives in the desktop shell (HIVE-422).
 *
 * A desktop that attaches to another Hive stores the device credential it was
 * handed at `<userData>/remote-credential.bin`, through one factory, and the
 * desktop platform's `remotePairing` writes and reads through that same
 * factory. A store per call, because `createTokenStore` holds nothing between
 * calls: a pair followed by a read must see the write.
 */

const userData = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => userData.dir },
  // Reversible and keyring-free: the store's own suite owns real encryption.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, 'utf8').reverse(),
    decryptString: (data: Buffer) => Buffer.from(data).reverse().toString('utf8'),
  },
}));

const { readRemoteCredential, remoteCredentialStore } = await import(
  '../../../../electron/main/ipc/remote-credential'
);
const { createDesktopPlatform } = await import('../../../../electron/main/platform');

beforeEach(() => {
  userData.dir = mkdtempSync(join(tmpdir(), 'hive-remote-credential-'));
});

afterEach(() => {
  rmSync(userData.dir, { recursive: true, force: true });
});

describe('remoteCredentialStore', () => {
  it('writes to remote-credential.bin under userData', () => {
    expect(remoteCredentialStore().write('laptop', 'sekret')).toBe(true);
    expect(existsSync(join(userData.dir, 'remote-credential.bin'))).toBe(true);
  });
});

describe("the desktop platform's remotePairing", () => {
  it('pairs through the factory, and readRemoteCredential reads back what it wrote', () => {
    const pairing = createDesktopPlatform().desktop!.remotePairing;

    expect(pairing.paired()).toBe(false);
    expect(pairing.pair({ deviceId: 'laptop', token: 'sekret' })).toEqual({ paired: true });
    expect(pairing.paired()).toBe(true);
    expect(readRemoteCredential()).toMatchObject({ deviceId: 'laptop', token: 'sekret' });

    pairing.forget();
    expect(pairing.paired()).toBe(false);
    expect(readRemoteCredential()).toBeNull();
  });
});
