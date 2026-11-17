import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

/**
 * Noise_NNpsk0_25519_AESGCM_SHA256 (Noise spec rev. 34), on `node:crypto` alone (HIVE-428).
 *
 * Message 1 is `psk, e`; message 2 is `e, ee`. AES-256-GCM, not ChaCha20-Poly1305: the latter does
 * not exist in Electron's BoringSSL. Pure functions over Buffers; this file knows nothing of
 * sockets. Proven byte for byte against the published vector in
 * `tests/electron/remote-channel/fixtures/`.
 */

const PROTOCOL_NAME = 'Noise_NNpsk0_25519_AESGCM_SHA256';
const DH_LEN = 32;
const HASH_LEN = 32;
const TAG_LEN = 16;
const MAX_NONCE = 2n ** 64n - 1n;
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');
const EMPTY: Buffer = Buffer.alloc(0);

/** A 32-byte ephemeral public key and the 16-byte tag over an empty payload. */
export const NOISE_HANDSHAKE_MESSAGE_BYTES = DH_LEN + TAG_LEN;

export class NoiseError extends Error {}

export interface CipherState {
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
}

export interface Transport {
  send: CipherState;
  receive: CipherState;
  handshakeHash: Buffer;
}

export interface HandshakeOptions {
  prologue: Buffer;
  psk: Buffer;
  ephemeral?: KeyObject;
}

const sha256 = (...parts: Buffer[]): Buffer => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
};

const hmac = (key: Buffer, ...parts: Buffer[]): Buffer => {
  const mac = createHmac('sha256', key);
  for (const part of parts) mac.update(part);
  return mac.digest();
};

function hkdf(chainingKey: Buffer, input: Buffer, outputs: number): Buffer[] {
  const temp = hmac(chainingKey, input);
  const out: Buffer[] = [];
  let previous: Buffer = EMPTY;
  for (let index = 1; index <= outputs; index += 1) {
    previous = hmac(temp, previous, Buffer.from([index]));
    out.push(previous);
  }
  return out;
}

/** An X25519 private key from its raw 32 bytes, for the vector test's fixed ephemerals. */
export function privateKeyFromRaw(raw: Buffer): KeyObject {
  return createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: 'der', type: 'pkcs8' });
}

const publicKeyFromRaw = (raw: Buffer): KeyObject =>
  createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' });

const rawPublicOf = (privateKey: KeyObject): Buffer =>
  createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(SPKI_X25519.length);

/** Four zero bytes, then the counter big-endian (Noise 12.4, AESGCM). */
function nonceOf(counter: bigint): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(counter, 4);
  return nonce;
}

function seal(key: Buffer, counter: bigint, associated: Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonceOf(counter), { authTagLength: TAG_LEN });
  cipher.setAAD(associated);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function open(key: Buffer, counter: bigint, associated: Buffer, ciphertext: Buffer): Buffer {
  if (ciphertext.length < TAG_LEN) throw new NoiseError('ciphertext shorter than its tag');
  const body = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonceOf(counter), { authTagLength: TAG_LEN });
  decipher.setAAD(associated);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_LEN));
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new NoiseError('decryption failed');
  }
}

/** One direction of a transport: its own key and its own counter. */
function cipherState(key: Buffer): CipherState {
  let counter = 0n;
  return {
    encrypt(plaintext) {
      if (counter === MAX_NONCE) throw new NoiseError('nonce exhausted');
      const current = counter;
      counter += 1n;
      return seal(key, current, EMPTY, plaintext);
    },
    // The counter moves only on success, so a forged frame cannot desynchronise a live channel.
    decrypt(ciphertext) {
      if (counter === MAX_NONCE) throw new NoiseError('nonce exhausted');
      const plaintext = open(key, counter, EMPTY, ciphertext);
      counter += 1n;
      return plaintext;
    },
  };
}

interface SymmetricState {
  mixHash(data: Buffer): void;
  mixKey(input: Buffer): void;
  mixKeyAndHash(input: Buffer): void;
  encryptAndHash(plaintext: Buffer): Buffer;
  decryptAndHash(ciphertext: Buffer): Buffer;
  split(isInitiator: boolean): Transport;
}

function symmetricState(prologue: Buffer): SymmetricState {
  // Noise 5.2: a name of at most HASHLEN bytes is zero-padded, not hashed. This one is exactly 32.
  const name = Buffer.from(PROTOCOL_NAME, 'ascii');
  let h: Buffer = name.length <= HASH_LEN ? Buffer.concat([name, Buffer.alloc(HASH_LEN - name.length)]) : sha256(name);
  let ck: Buffer = h;
  // Every handshake token that encrypts runs after a MixKey, so `k` is always set by then.
  let k: Buffer = EMPTY;
  let n = 0n;
  const mixHash = (data: Buffer): void => {
    h = sha256(h, data);
  };
  mixHash(prologue);
  return {
    mixHash,
    mixKey(input) {
      [ck, k] = hkdf(ck, input, 2);
      n = 0n;
    },
    mixKeyAndHash(input) {
      const [nextCk, tempH, nextK] = hkdf(ck, input, 3);
      ck = nextCk;
      mixHash(tempH);
      k = nextK;
      n = 0n;
    },
    encryptAndHash(plaintext) {
      const ciphertext = seal(k, n, h, plaintext);
      n += 1n;
      mixHash(ciphertext);
      return ciphertext;
    },
    decryptAndHash(ciphertext) {
      const plaintext = open(k, n, h, ciphertext);
      n += 1n;
      mixHash(ciphertext);
      return plaintext;
    },
    split(isInitiator) {
      const [first, second] = hkdf(ck, EMPTY, 2);
      return {
        send: cipherState(isInitiator ? first : second),
        receive: cipherState(isInitiator ? second : first),
        handshakeHash: h,
      };
    },
  };
}

const freshEphemeral = (): KeyObject => generateKeyPairSync('x25519').privateKey;

export function initiator({ prologue, psk, ephemeral = freshEphemeral() }: HandshakeOptions): {
  writeMessage1(payload?: Buffer): Buffer;
  readMessage2(message: Buffer): { payload: Buffer; transport: Transport };
} {
  const state = symmetricState(prologue);
  return {
    writeMessage1(payload = EMPTY) {
      state.mixKeyAndHash(psk);
      const e = rawPublicOf(ephemeral);
      state.mixHash(e);
      // psk mode: the `e` token also calls MixKey on the public key.
      state.mixKey(e);
      return Buffer.concat([e, state.encryptAndHash(payload)]);
    },
    readMessage2(message) {
      if (message.length < DH_LEN + TAG_LEN) throw new NoiseError('message 2 too short');
      const re = message.subarray(0, DH_LEN);
      state.mixHash(re);
      state.mixKey(re);
      state.mixKey(diffieHellman({ privateKey: ephemeral, publicKey: publicKeyFromRaw(re) }));
      const payload = state.decryptAndHash(message.subarray(DH_LEN));
      return { payload, transport: state.split(true) };
    },
  };
}

export function responder({ prologue, psk, ephemeral = freshEphemeral() }: HandshakeOptions): {
  readMessage1(message: Buffer): Buffer;
  writeMessage2(payload?: Buffer): { message: Buffer; transport: Transport };
} {
  const state = symmetricState(prologue);
  let re: Buffer | null = null;
  return {
    readMessage1(message) {
      if (message.length < DH_LEN + TAG_LEN) throw new NoiseError('message 1 too short');
      state.mixKeyAndHash(psk);
      const remote = message.subarray(0, DH_LEN);
      state.mixHash(remote);
      state.mixKey(remote);
      const payload = state.decryptAndHash(message.subarray(DH_LEN));
      // A copy, and only once message 1 verified: a failed read leaves nothing writeMessage2 can use.
      re = Buffer.from(remote);
      return payload;
    },
    writeMessage2(payload = EMPTY) {
      if (re === null) throw new NoiseError('message 1 has not been read');
      const e = rawPublicOf(ephemeral);
      state.mixHash(e);
      state.mixKey(e);
      state.mixKey(diffieHellman({ privateKey: ephemeral, publicKey: publicKeyFromRaw(re) }));
      const message = Buffer.concat([e, state.encryptAndHash(payload)]);
      return { message, transport: state.split(false) };
    },
  };
}
