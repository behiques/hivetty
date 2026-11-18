// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createKeyStore, createStateStore, freshState } from '../../../core/sync/state';

/**
 * `sync-state.json` (this Mac's merge base) and `<userData>/sync-key.bin` (the derived key, sealed by the
 * keychain) for settings sync (HIVE-284). Both are written atomically and read without ever throwing.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-state-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(`enc:${Buffer.from(s).toString('hex')}`),
  decryptString: (b: Buffer) => Buffer.from(b.toString().slice(4), 'hex').toString(),
});

describe('the state store', () => {
  it('starts fresh with every group on and nothing synced', () => {
    expect(freshState(false)).toEqual({
      v: 1,
      revision: 0,
      joined: false,
      lastSyncedAt: null,
      groups: { harnesses: true, automation: true, workspace: true },
      base: {},
      seen: {},
      kept: {},
    });
  });

  it('round-trips a state and leaves no temp file', () => {
    const store = createStateStore(join(dir, 'sync-state.json'));
    const state = { ...freshState(true), revision: 4, lastSyncedAt: 9, base: { a: 'h' } };
    store.write(state);
    expect(store.read()).toEqual(state);
    expect(readdirSync(dir)).toEqual(['sync-state.json']);
  });

  it.each([
    ['a missing file', null],
    ['broken JSON', '{'],
    ['another version', '{"v":2}'],
    ['a wrong shape', JSON.stringify({ ...freshState(true), groups: { harnesses: true } })],
    ['a non-integer revision', JSON.stringify({ ...freshState(true), revision: 1.5 })],
    ['a string lastSyncedAt', JSON.stringify({ ...freshState(true), lastSyncedAt: 'now' })],
    ['an array base', JSON.stringify({ ...freshState(true), base: [] })],
    ['a negative revision', JSON.stringify({ ...freshState(true), revision: -1 })],
    ['a non-string base hash', JSON.stringify({ ...freshState(true), base: { x: 1 } })],
    ['a non-string kept hash', JSON.stringify({ ...freshState(true), kept: { x: null } })],
    ['a null seen entry', JSON.stringify({ ...freshState(true), seen: { k: null } })],
    ['a seen entry without a time', JSON.stringify({ ...freshState(true), seen: { k: { hash: 'h' } } })],
  ])('reads null for %s', (_, content) => {
    const file = join(dir, 'sync-state.json');
    if (content !== null) writeFileSync(file, content);
    expect(createStateStore(file).read()).toBeNull();
  });

  it('clears quietly, twice', () => {
    const store = createStateStore(join(dir, 'sync-state.json'));
    store.write(freshState(true));
    store.clear();
    expect(() => store.clear()).not.toThrow();
    expect(store.read()).toBeNull();
  });

  it('throws when the file cannot be written, and leaves no temp file', () => {
    expect(() => createStateStore(join(dir, 'missing', 'sync-state.json')).write(freshState(true))).toThrow();
    const file = join(dir, 'sync-state.json');
    mkdirSync(file); // the rename onto a folder fails after the temp file was written
    expect(() => createStateStore(file).write(freshState(true))).toThrow();
    expect(readdirSync(dir)).toEqual(['sync-state.json']);
  });

  it('overwrites a temp file a crash left behind', () => {
    const file = join(dir, 'sync-state.json');
    writeFileSync(`${file}.${String(process.pid)}.tmp`, 'half');
    const store = createStateStore(file);
    store.write(freshState(true));
    expect(store.read()).toEqual(freshState(true));
    expect(readdirSync(dir)).toEqual(['sync-state.json']);
  });
});

describe('the key store', () => {
  const stored = { key: Buffer.alloc(32, 9).toString('base64'), salt: Buffer.alloc(16, 1).toString('base64'), userId: 'u1' };

  it('round-trips the key, sealed, with mode 0600 and no temp file', () => {
    const file = join(dir, 'sync-key.bin');
    const store = createKeyStore({ file, safeStorage: fakeSafeStorage() });
    expect(store.available()).toBe(true);
    expect(store.write(stored)).toBe(true);
    expect(store.read()).toEqual(stored);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file).toString()).not.toContain(stored.key);
    expect(readdirSync(dir)).toEqual(['sync-key.bin']);
  });

  it('answers false when the file cannot be written, and leaves no temp file', () => {
    expect(createKeyStore({ file: join(dir, 'missing', 'sync-key.bin'), safeStorage: fakeSafeStorage() }).write(stored)).toBe(
      false,
    );
    const file = join(dir, 'sync-key.bin');
    mkdirSync(file);
    expect(createKeyStore({ file, safeStorage: fakeSafeStorage() }).write(stored)).toBe(false);
    expect(readdirSync(dir)).toEqual(['sync-key.bin']);
  });

  it('tightens a leftover temp file to 0600', () => {
    const file = join(dir, 'sync-key.bin');
    writeFileSync(`${file}.${String(process.pid)}.tmp`, 'old', { mode: 0o644 });
    createKeyStore({ file, safeStorage: fakeSafeStorage() }).write(stored);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('seals only the key, the salt and the user id, whatever the caller passes', () => {
    const file = join(dir, 'sync-key.bin');
    createKeyStore({ file, safeStorage: fakeSafeStorage() }).write({ ...stored, passphrase: 'hunter2hunter2' } as typeof stored);
    expect(fakeSafeStorage().decryptString(readFileSync(file))).not.toContain('hunter2');
  });

  it('writes nothing and reads nothing without keychain encryption', () => {
    const file = join(dir, 'sync-key.bin');
    const store = createKeyStore({ file, safeStorage: fakeSafeStorage(false) });
    expect(store.available()).toBe(false);
    expect(store.write(stored)).toBe(false);
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, fakeSafeStorage().encryptString(JSON.stringify(stored)));
    expect(store.read()).toBeNull();
  });

  it('reads null when the keychain item is gone', () => {
    const file = join(dir, 'sync-key.bin');
    createKeyStore({ file, safeStorage: fakeSafeStorage() }).write(stored);
    const broken = {
      ...fakeSafeStorage(),
      decryptString: () => {
        throw new Error('keychain item missing');
      },
    };
    expect(createKeyStore({ file, safeStorage: broken }).read()).toBeNull();
  });

  it.each([
    ['a missing file', null],
    ['a wrong shape', JSON.stringify({ key: 1, salt: 's', userId: 'u' })],
    ['not an object', JSON.stringify('key')],
  ])('reads null for %s', (_, content) => {
    const file = join(dir, 'sync-key.bin');
    if (content !== null) writeFileSync(file, fakeSafeStorage().encryptString(content));
    expect(createKeyStore({ file, safeStorage: fakeSafeStorage() }).read()).toBeNull();
  });

  it('clears quietly, twice', () => {
    const file = join(dir, 'sync-key.bin');
    const store = createKeyStore({ file, safeStorage: fakeSafeStorage() });
    store.write(stored);
    store.clear();
    expect(() => store.clear()).not.toThrow();
    expect(store.read()).toBeNull();
  });
});
