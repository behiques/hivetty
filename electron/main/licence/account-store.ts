import type { JsonWebKey } from 'node:crypto';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

/**
 * `<userData>/account.bin`: the signed-in account (HIVE-264), one safeStorage-encrypted JSON.
 * The shape of `electron/remote-client/token-store.ts`: `read` never throws, `write` refuses plaintext and
 * says so with `false`, `clear` needs no key. The access token is never here; it lives in memory.
 */

export interface DeviceKey {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}

export interface StoredAccount {
  refreshToken: string;
  deviceId: string;
  deviceKey: DeviceKey;
  email: string;
  name: string;
}

export interface AccountStore {
  read(): StoredAccount | null;
  write(account: StoredAccount): boolean;
  clear(): void;
}

export type AccountSafeStorage = Pick<
  Electron.SafeStorage,
  'isEncryptionAvailable' | 'encryptString' | 'decryptString'
>;

export const NO_ENCRYPTION =
  'This Mac has no keychain available to encrypt your HiveTTY account, so signing in cannot be saved. ' +
  'Unlock the login keychain and sign in again.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEd25519 = (jwk: unknown, needsPrivate: boolean): boolean =>
  isRecord(jwk) &&
  jwk.kty === 'OKP' &&
  jwk.crv === 'Ed25519' &&
  typeof jwk.x === 'string' &&
  (!needsPrivate || typeof jwk.d === 'string');

function isStoredAccount(value: unknown): value is StoredAccount {
  return (
    isRecord(value) &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken !== '' &&
    typeof value.deviceId === 'string' &&
    value.deviceId !== '' &&
    typeof value.email === 'string' &&
    typeof value.name === 'string' &&
    isRecord(value.deviceKey) &&
    isEd25519(value.deviceKey.publicJwk, false) &&
    isEd25519(value.deviceKey.privateJwk, true)
  );
}

export function createAccountStore({
  safeStorage,
  filePath,
}: {
  safeStorage: AccountSafeStorage;
  filePath: string;
}): AccountStore {
  return {
    read() {
      if (!safeStorage.isEncryptionAvailable()) return null;
      try {
        const parsed: unknown = JSON.parse(safeStorage.decryptString(readFileSync(filePath)));
        return isStoredAccount(parsed) ? parsed : null;
      } catch {
        // ENOENT, a copied userData, a rotated key, a corrupt file: all "no account".
        return null;
      }
    },
    write(account) {
      if (!safeStorage.isEncryptionAvailable()) return false;
      writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(account)), { mode: 0o600 });
      chmodSync(filePath, 0o600); // the mode above applies only on create
      return true;
    },
    clear() {
      rmSync(filePath, { force: true });
    },
  };
}
