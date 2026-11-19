// @vitest-environment node
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createSecrets, SecretEnvelopeError } from '../../../server/secrets/envelope';

const KEY = Buffer.alloc(32, 7);
const OTHER = Buffer.alloc(32, 9);
const failureOf = (run: () => unknown): string => {
  try {
    run();
  } catch (cause) {
    if (cause instanceof SecretEnvelopeError) return cause.failure;
    throw cause;
  }
  throw new Error('did not throw');
};

describe('the server secret envelope (HIVE-424)', () => {
  it('round-trips text, unicode included', () => {
    const secrets = createSecrets(KEY, vi.fn());
    expect(secrets.isEncryptionAvailable()).toBe(true);
    expect(secrets.decryptString(secrets.encryptString('tøken ✓'))).toBe('tøken ✓');
    expect(secrets.decryptString(secrets.encryptString(''))).toBe('');
  });

  it('lays out version, key id, nonce, ciphertext, tag', () => {
    const sealed = createSecrets(KEY, vi.fn()).encryptString('abc');
    expect(sealed[0]).toBe(0x01);
    expect(sealed.subarray(1, 9)).toEqual(createHash('sha256').update(KEY).digest().subarray(0, 8));
    expect(sealed.length).toBe(1 + 8 + 12 + 3 + 16);
    expect(sealed.includes('abc')).toBe(false);
  });

  it('never seals the same text to the same bytes', () => {
    const secrets = createSecrets(KEY, vi.fn());
    expect(secrets.encryptString('abc')).not.toEqual(secrets.encryptString('abc'));
  });

  it('names a wrong key', () => {
    const sealed = createSecrets(OTHER, vi.fn()).encryptString('abc');
    expect(failureOf(() => createSecrets(KEY, vi.fn()).decryptString(sealed))).toBe('key');
  });

  it('names an unknown version', () => {
    const sealed = createSecrets(KEY, vi.fn()).encryptString('abc');
    sealed[0] = 0x02;
    expect(failureOf(() => createSecrets(KEY, vi.fn()).decryptString(sealed))).toBe('version');
  });

  it('names a truncated file, before it reads a version from it', () => {
    const secrets = createSecrets(KEY, vi.fn());
    expect(failureOf(() => secrets.decryptString(Buffer.from([0x02, 1, 2])))).toBe('truncated');
    expect(failureOf(() => secrets.decryptString(secrets.encryptString('').subarray(0, 36)))).toBe('truncated');
  });

  it.each([
    ['the tag', -1],
    ['the ciphertext', 21],
    ['the nonce', 9],
  ])('names tampering with %s', (_what, index) => {
    const secrets = createSecrets(KEY, vi.fn());
    const sealed = secrets.encryptString('abc');
    const at = index < 0 ? sealed.length + index : index;
    sealed[at] = (sealed[at] ?? 0) ^ 0xff;
    expect(failureOf(() => secrets.decryptString(sealed))).toBe('tampered');
  });

  it('warns once for a wrong key or version, with both key ids and no key, and never for damage', () => {
    const warn = vi.fn();
    const secrets = createSecrets(KEY, warn);
    const foreign = createSecrets(OTHER, vi.fn()).encryptString('abc');
    const damaged = secrets.encryptString('abc');
    damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 0xff;

    expect(() => secrets.decryptString(damaged)).toThrow(SecretEnvelopeError);
    expect(() => secrets.decryptString(Buffer.from([1]))).toThrow(SecretEnvelopeError);
    expect(warn).not.toHaveBeenCalled();

    expect(() => secrets.decryptString(foreign)).toThrow(SecretEnvelopeError);
    expect(() => secrets.decryptString(foreign)).toThrow(SecretEnvelopeError);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain(createHash('sha256').update(KEY).digest().subarray(0, 8).toString('hex'));
    expect(line).toContain(createHash('sha256').update(OTHER).digest().subarray(0, 8).toString('hex'));
    expect(line).toContain('hivetty-server --login');
    expect(line).not.toContain(KEY.toString('hex'));
    expect(line).not.toContain(KEY.toString('base64'));
  });

  it('warns through console.error by default', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sealed = createSecrets(OTHER).encryptString('abc');
    expect(() => createSecrets(KEY).decryptString(sealed)).toThrow(SecretEnvelopeError);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
