import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';

export const SALT_BYTES = 16;
export const SCRYPT_COST = 2 ** 17;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const aad = (userId: string): Buffer => Buffer.from(`hivetty-sync-v1${userId}`, 'utf8');

/**
 * scrypt N=2^17, r=8, p=1, 32 bytes (HIVE-284). That cost needs about 134 MB; Node's default limit is 32 MB.
 * The passphrase is NFKC-normalized so the same phrase typed on two keyboards derives the same key. `cost`
 * exists for tests; production never passes it.
 */
export function deriveKey(passphrase: string, salt: Buffer, cost: number = SCRYPT_COST): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase.normalize('NFKC'), salt, 32, { N: cost, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** `nonce || ciphertext || tag`, AES-256-GCM, a fresh nonce per write, bound to the user by the AAD. */
export function seal(key: Buffer, userId: string, plaintext: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(userId));
  return Buffer.concat([nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Null for anything that does not authenticate: a wrong passphrase reads as exactly this. Never throws. */
export function open(key: Buffer, userId: string, blob: Buffer): Buffer | null {
  if (blob.length < NONCE_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, NONCE_BYTES));
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(blob.subarray(blob.length - TAG_BYTES));
    return Buffer.concat([decipher.update(blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES)), decipher.final()]);
  } catch {
    return null;
  }
}
