// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { deriveKey, open, seal } from '../../../core/sync/crypto';

/**
 * Settings sync's encryption (HIVE-284): a scrypt key from the passphrase, AES-256-GCM per write, bound to
 * the user by the AAD. A wrong passphrase reads as `open` answering null.
 */

const salt = Buffer.alloc(16, 7);
const text = Buffer.from('{"v":1}');
const cheap = 2 ** 10;

describe('sync crypto', () => {
  it('derives the same 32 bytes from the same passphrase and salt, and different ones otherwise', async () => {
    const a = await deriveKey('correct horse battery', salt, cheap);
    expect(a).toHaveLength(32);
    expect(a.equals(await deriveKey('correct horse battery', salt, cheap))).toBe(true);
    expect(a.equals(await deriveKey('correct horse batterx', salt, cheap))).toBe(false);
    expect(a.equals(await deriveKey('correct horse battery', Buffer.alloc(16, 8), cheap))).toBe(false);
  });

  it('derives the same key from a composed and a decomposed spelling of one passphrase', async () => {
    const composed = await deriveKey('café au lait please', salt, cheap);
    expect(composed.equals(await deriveKey('café au lait please', salt, cheap))).toBe(true);
  });

  it('derives at the production cost without exceeding the memory limit', async () => {
    await expect(deriveKey('correct horse battery', salt)).resolves.toHaveLength(32);
  });

  it('rejects when scrypt refuses its parameters', async () => {
    await expect(deriveKey('p', salt, 3)).rejects.toThrow();
  });

  it('round-trips, with a fresh nonce per write', async () => {
    const key = await deriveKey('p', salt, cheap);
    const one = seal(key, 'u1', text);
    const two = seal(key, 'u1', text);
    expect(one.equals(two)).toBe(false);
    expect(one.subarray(0, 12).equals(two.subarray(0, 12))).toBe(false);
    expect(one).toHaveLength(12 + text.length + 16);
    expect(open(key, 'u1', one)?.equals(text)).toBe(true);
  });

  it('opens nothing with a wrong key, a tampered byte, another user or a short blob', async () => {
    const key = await deriveKey('p', salt, cheap);
    const blob = seal(key, 'u1', text);
    expect(open(await deriveKey('q', salt, cheap), 'u1', blob)).toBeNull();
    for (const at of [0, 12, blob.length - 1]) {
      const bad = Buffer.from(blob);
      bad[at] = (bad[at] ?? 0) ^ 1;
      expect(open(key, 'u1', bad)).toBeNull();
    }
    expect(open(key, 'u2', blob)).toBeNull();
    expect(open(key, 'u1', blob.subarray(0, 27))).toBeNull();
  });

  it('never throws, even for a key of the wrong length', () => {
    expect(open(Buffer.alloc(5), 'u1', Buffer.alloc(40))).toBeNull();
  });
});
