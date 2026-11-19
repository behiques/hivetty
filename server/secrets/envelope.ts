import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { Secrets } from '../../core/platform';

const VERSION = 0x01;
const KEY_ID_BYTES = 8;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + KEY_ID_BYTES;
const MIN_BYTES = HEADER_BYTES + NONCE_BYTES + TAG_BYTES;

export type EnvelopeFailure = 'version' | 'key' | 'truncated' | 'tampered';

/** Why an envelope did not open. The stores read every one of these as "no credential". */
export class SecretEnvelopeError extends Error {
  readonly failure: EnvelopeFailure;

  constructor(failure: EnvelopeFailure, message: string) {
    super(message);
    this.name = 'SecretEnvelopeError';
    this.failure = failure;
  }
}

/**
 * The server's secret store (HIVE-424): AES-256-GCM under a key the operator supplies, never one kept beside the
 * data. `version || key id || nonce || ciphertext || tag`, the first nine bytes authenticated as AAD. The key id
 * (the head of the key's SHA-256) is what lets a later `--rotate-key` tell old files from new.
 */
export function createSecrets(key: Buffer, warn: (line: string) => void = (line) => console.error(line)): Secrets {
  const keyId = createHash('sha256').update(key).digest().subarray(0, KEY_ID_BYTES);
  const header = Buffer.concat([Buffer.from([VERSION]), keyId]);
  let warned = false;
  // Every store swallows a failed read as "signed out", so a wrong key would otherwise be silent. Once per process.
  const foreign = (failure: 'version' | 'key', detail: string): never => {
    if (!warned) {
      warned = true;
      warn(
        `[secrets] A stored credential ${detail}; this server's key is id ${keyId.toString('hex')}. ` +
          'It reads as signed out. Start with the key that sealed it, or sign in again with ' +
          '`hivetty-server --login` and re-enter any integration tokens.',
      );
    }
    throw new SecretEnvelopeError(failure, `secret envelope: ${detail}`);
  };
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(header);
      return Buffer.concat([header, nonce, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString(data) {
      if (data.length < MIN_BYTES) throw new SecretEnvelopeError('truncated', 'secret envelope: too short');
      if (data[0] !== VERSION) return foreign('version', `was written in format version ${String(data[0])}`);
      const id = data.subarray(1, HEADER_BYTES);
      if (!id.equals(keyId)) return foreign('key', `was sealed with another key (id ${id.toString('hex')})`);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES));
        decipher.setAAD(header);
        decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
        const body = data.subarray(HEADER_BYTES + NONCE_BYTES, data.length - TAG_BYTES);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
      } catch {
        // decipher.final() throws when the tag does not authenticate: a flipped byte anywhere, header included.
        throw new SecretEnvelopeError('tampered', 'secret envelope: does not authenticate');
      }
    },
  };
}
