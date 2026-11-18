import type { JsonWebKey } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

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
  /** HIVE-291: the org the lease is asked for. Sign-out deletes the file, so it goes with the account. */
  activeOrg?: string;
}

export interface AccountStore {
  read(): StoredAccount | null;
  write(account: StoredAccount): boolean;
  clear(): void;
  /** Whether `account.bin` is on disk, readable or not (HIVE-266: a locked keychain is not a sign-out). */
  exists(): boolean;
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
    (value.activeOrg === undefined || typeof value.activeOrg === 'string') &&
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
      // A rotated refresh token must never be half-written or lost to a throw: write a sibling, then
      // rename it over the old blob, and answer false on any failure so the caller can say so.
      const tmp = `${filePath}.tmp`;
      try {
        writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(account)), { mode: 0o600 });
        chmodSync(tmp, 0o600); // the mode above applies only on create
        renameSync(tmp, filePath);
        return true;
      } catch {
        rmSync(tmp, { force: true });
        return false;
      }
    },
    clear() {
      rmSync(filePath, { force: true });
    },
    exists: () => existsSync(filePath),
  };
}
