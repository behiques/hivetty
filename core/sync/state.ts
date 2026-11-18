import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

import { SYNC_GROUPS, type SyncGroup } from '@shared/sync-contract';

import type { Secrets } from '../platform';

/** This Mac's side of settings sync (HIVE-284), kept beside config.json as `sync-state.json`. */
export interface SyncState {
  v: 1;
  /** The cloud revision this Mac last pulled or pushed; 0 before the first. */
  revision: number;
  /** False until a joining Mac's first merge has been applied. */
  joined: boolean;
  lastSyncedAt: number | null;
  /** The three switches. Per Mac, and not a config key, so they cannot sync by accident. */
  groups: Record<SyncGroup, boolean>;
  /** The hash each id had when this Mac last agreed with the cloud: the merge base. */
  base: Record<string, string>;
  /** Each config key's last seen hash and when it was first seen: the "at" of a key. */
  seen: Record<string, { hash: string; at: number }>;
  /** The losing hash already copied to the conflicts folder, per id, so a retry does not copy it twice. */
  kept: Record<string, string>;
}

export const freshState = (joined: boolean): SyncState => ({
  v: 1,
  revision: 0,
  joined,
  lastSyncedAt: null,
  groups: { harnesses: true, automation: true, workspace: true },
  base: {},
  seen: {},
  kept: {},
});

/** A sibling temp file, then a rename: a crash between the two leaves the old file whole. */
function writeAtomic(file: string, data: string | Buffer, mode?: number): void {
  const tmp = `${file}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(tmp, data, mode === undefined ? {} : { mode });
    if (mode !== undefined) chmodSync(tmp, mode); // the mode above applies only on create
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const allStrings = (value: unknown): boolean =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const allSeen = (value: unknown): boolean =>
  isRecord(value) &&
  Object.values(value).every((entry) => isRecord(entry) && typeof entry.hash === 'string' && typeof entry.at === 'number');

function isState(value: unknown): value is SyncState {
  if (!isRecord(value)) return false;
  const groups = value.groups;
  return (
    value.v === 1 &&
    Number.isInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    typeof value.joined === 'boolean' &&
    (value.lastSyncedAt === null || typeof value.lastSyncedAt === 'number') &&
    isRecord(groups) &&
    SYNC_GROUPS.every((group) => typeof groups[group] === 'boolean') &&
    allStrings(value.base) &&
    allSeen(value.seen) &&
    allStrings(value.kept)
  );
}

export interface StateStore {
  /** Null for a missing, unreadable or wrongly shaped file. Never throws. */
  read(): SyncState | null;
  /** Throws when the file cannot be written; the cycle reports it and redoes the merge next time. */
  write(state: SyncState): void;
  clear(): void;
}

export function createStateStore(file: string): StateStore {
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        return isState(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    write(state) {
      writeAtomic(file, JSON.stringify(state));
    },
    clear() {
      rmSync(file, { force: true });
    },
  };
}

export interface StoredKey {
  /** The derived key, base64. Never the passphrase. */
  key: string;
  /** The salt it was derived with, base64, as the cloud holds it. */
  salt: string;
  /** The lease subject the key is bound to (the AAD). */
  userId: string;
}

export interface KeyStoreDeps {
  file: string;
  safeStorage: Secrets;
}

export interface KeyStore {
  available(): boolean;
  read(): StoredKey | null;
  /** False, with nothing written, without keychain encryption or when the write fails. */
  write(key: StoredKey): boolean;
  clear(): void;
}

/** The derived key, sealed by the OS keychain (the account-store pattern). Never the passphrase, never config.json. */
export function createKeyStore({ file, safeStorage }: KeyStoreDeps): KeyStore {
  const available = (): boolean => safeStorage.isEncryptionAvailable();
  return {
    available,
    read() {
      if (!available()) return null;
      try {
        const parsed: unknown = JSON.parse(safeStorage.decryptString(readFileSync(file)));
        return isRecord(parsed) &&
          typeof parsed.key === 'string' &&
          typeof parsed.salt === 'string' &&
          typeof parsed.userId === 'string'
          ? { key: parsed.key, salt: parsed.salt, userId: parsed.userId }
          : null;
      } catch {
        // Missing, a rotated keychain item, a corrupt file: all "no key", so the tab asks again.
        return null;
      }
    },
    write(key) {
      if (!available()) return false;
      try {
        const sealed = { key: key.key, salt: key.salt, userId: key.userId }; // nothing else, whatever is passed
        writeAtomic(file, safeStorage.encryptString(JSON.stringify(sealed)), 0o600);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      rmSync(file, { force: true });
    },
  };
}
