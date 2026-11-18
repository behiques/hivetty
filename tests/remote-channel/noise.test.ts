import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NOISE_HANDSHAKE_MESSAGE_BYTES,
  NoiseError,
  initiator,
  privateKeyFromRaw,
  responder,
  type Transport,
} from '../../remote-channel/noise';

/**
 * Noise_NNpsk0_25519_AESGCM_SHA256 (HIVE-428).
 *
 * The fixture is the published cacophony vector for this exact protocol name. It pins the three
 * details that are easy to get wrong and invisible when both ends share the same mistake: the
 * big-endian AES-GCM nonce, the zero-padded (not hashed) 32-byte protocol name, and the psk-mode
 * MixKey on the `e` token.
 */

interface Vector {
  init_prologue: string;
  init_psks: string[];
  init_ephemeral: string;
  resp_prologue: string;
  resp_psks: string[];
  resp_ephemeral: string;
  handshake_hash: string;
  messages: { payload: string; ciphertext: string }[];
}

const vector = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'noise-nnpsk0-25519-aesgcm-sha256.json'), 'utf8'),
) as Vector;

const hex = (value: string): Buffer => Buffer.from(value, 'hex');

function handshake(options: {
  psk?: Buffer;
  responderPsk?: Buffer;
  prologue?: Buffer;
  responderPrologue?: Buffer;
} = {}): { initiator: Transport; responder: Transport } {
  const psk = options.psk ?? Buffer.alloc(32, 7);
  const prologue = options.prologue ?? Buffer.from('test');
  const init = initiator({ prologue, psk });
  const resp = responder({
    prologue: options.responderPrologue ?? prologue,
    psk: options.responderPsk ?? psk,
  });
  resp.readMessage1(init.writeMessage1());
  const { message, transport } = resp.writeMessage2();
  return { initiator: init.readMessage2(message).transport, responder: transport };
}

describe('Noise NNpsk0 against the published vector', () => {
  it('produces the vector byte for byte, both handshake messages and every transport message', () => {
    const init = initiator({
      prologue: hex(vector.init_prologue),
      psk: hex(vector.init_psks[0]),
      ephemeral: privateKeyFromRaw(hex(vector.init_ephemeral)),
    });
    const resp = responder({
      prologue: hex(vector.resp_prologue),
      psk: hex(vector.resp_psks[0]),
      ephemeral: privateKeyFromRaw(hex(vector.resp_ephemeral)),
    });

    const message1 = init.writeMessage1(hex(vector.messages[0].payload));
    expect(message1.toString('hex')).toBe(vector.messages[0].ciphertext);
    expect(resp.readMessage1(message1).toString('hex')).toBe(vector.messages[0].payload);

    const { message: message2, transport: respTransport } = resp.writeMessage2(hex(vector.messages[1].payload));
    expect(message2.toString('hex')).toBe(vector.messages[1].ciphertext);
    const { payload, transport: initTransport } = init.readMessage2(message2);
    expect(payload.toString('hex')).toBe(vector.messages[1].payload);

    expect(initTransport.handshakeHash.toString('hex')).toBe(vector.handshake_hash);
    expect(respTransport.handshakeHash.toString('hex')).toBe(vector.handshake_hash);

    vector.messages.slice(2).forEach((message, index) => {
      const [sender, receiver] = index % 2 === 0 ? [initTransport, respTransport] : [respTransport, initTransport];
      const ciphertext = sender.send.encrypt(hex(message.payload));
      expect(ciphertext.toString('hex')).toBe(message.ciphertext);
      expect(receiver.receive.decrypt(ciphertext).toString('hex')).toBe(message.payload);
    });
  });
});

describe('Noise NNpsk0 with fresh keys', () => {
  it('makes both handshake messages 48 bytes over an empty payload', () => {
    const psk = Buffer.alloc(32, 1);
    const init = initiator({ prologue: Buffer.from('p'), psk });
    const resp = responder({ prologue: Buffer.from('p'), psk });
    const message1 = init.writeMessage1();
    expect(message1).toHaveLength(NOISE_HANDSHAKE_MESSAGE_BYTES);
    resp.readMessage1(message1);
    expect(resp.writeMessage2().message).toHaveLength(NOISE_HANDSHAKE_MESSAGE_BYTES);
    expect(NOISE_HANDSHAKE_MESSAGE_BYTES).toBe(48);
  });

  it('refuses a wrong pre-shared key on message 1', () => {
    expect(() => handshake({ psk: Buffer.alloc(32, 1), responderPsk: Buffer.alloc(32, 2) })).toThrow(NoiseError);
    const message1 = initiator({ prologue: Buffer.from('p'), psk: Buffer.alloc(32, 1) }).writeMessage1();
    expect(() => responder({ prologue: Buffer.from('p'), psk: Buffer.alloc(32, 2) }).readMessage1(message1)).toThrow(
      NoiseError,
    );
  });

  it('refuses to write message 2 after message 1 failed to verify', () => {
    const message1 = initiator({ prologue: Buffer.from('p'), psk: Buffer.alloc(32, 1) }).writeMessage1();
    const resp = responder({ prologue: Buffer.from('p'), psk: Buffer.alloc(32, 2) });
    expect(() => resp.readMessage1(message1)).toThrow(NoiseError);
    expect(() => resp.writeMessage2()).toThrow(NoiseError);
  });

  it('refuses a wrong prologue on message 1', () => {
    expect(() => handshake({ prologue: Buffer.from('a'), responderPrologue: Buffer.from('b') })).toThrow(NoiseError);
  });

  it('refuses a message 1 with one flipped byte', () => {
    const psk = Buffer.alloc(32, 3);
    const message1 = initiator({ prologue: Buffer.from('p'), psk }).writeMessage1();
    message1[40] ^= 1;
    expect(() => responder({ prologue: Buffer.from('p'), psk }).readMessage1(message1)).toThrow(NoiseError);
  });

  it('refuses a message too short to hold a key and a tag', () => {
    const psk = Buffer.alloc(32, 3);
    expect(() => responder({ prologue: Buffer.from('p'), psk }).readMessage1(Buffer.alloc(47))).toThrow(NoiseError);
    expect(() => initiator({ prologue: Buffer.from('p'), psk }).readMessage2(Buffer.alloc(47))).toThrow(NoiseError);
  });

  it('refuses to write message 2 before message 1 was read', () => {
    expect(() => responder({ prologue: Buffer.from('p'), psk: Buffer.alloc(32) }).writeMessage2()).toThrow(NoiseError);
  });

  it('throws, without crashing, on a message 1 whose ephemeral key is all zero', () => {
    const psk = Buffer.alloc(32, 4);
    const good = initiator({ prologue: Buffer.from('p'), psk }).writeMessage1();
    const zeroKey = Buffer.concat([Buffer.alloc(32), good.subarray(32)]);
    // The tag no longer verifies, so this is a NoiseError; a low-order point reaching DH would throw too.
    expect(() => responder({ prologue: Buffer.from('p'), psk }).readMessage1(zeroKey)).toThrow();
  });

  it('throws, without crashing, on a message 2 whose ephemeral key is all zero', () => {
    const psk = Buffer.alloc(32, 4);
    const init = initiator({ prologue: Buffer.from('p'), psk });
    const resp = responder({ prologue: Buffer.from('p'), psk });
    resp.readMessage1(init.writeMessage1());
    const { message } = resp.writeMessage2();
    expect(() => init.readMessage2(Buffer.concat([Buffer.alloc(32), message.subarray(32)]))).toThrow();
  });

  it('carries transport messages both ways', () => {
    const pair = handshake();
    const out = pair.initiator.send.encrypt(Buffer.from('hello'));
    expect(pair.responder.receive.decrypt(out).toString()).toBe('hello');
    const back = pair.responder.send.encrypt(Buffer.from('world'));
    expect(pair.initiator.receive.decrypt(back).toString()).toBe('world');
  });

  it('refuses a reordered transport frame', () => {
    const pair = handshake();
    const first = pair.initiator.send.encrypt(Buffer.from('one'));
    const second = pair.initiator.send.encrypt(Buffer.from('two'));
    expect(() => pair.responder.receive.decrypt(second)).toThrow(NoiseError);
    expect(pair.responder.receive.decrypt(first).toString()).toBe('one');
  });

  it('refuses a replayed transport frame', () => {
    const pair = handshake();
    const frame = pair.initiator.send.encrypt(Buffer.from('once'));
    expect(pair.responder.receive.decrypt(frame).toString()).toBe('once');
    expect(() => pair.responder.receive.decrypt(frame)).toThrow(NoiseError);
  });

  it('refuses a frame with one flipped byte, and still decrypts the next one', () => {
    const pair = handshake();
    const frame = pair.initiator.send.encrypt(Buffer.from('tamper me'));
    const tampered = Buffer.from(frame);
    tampered[0] ^= 0x80;
    expect(() => pair.responder.receive.decrypt(tampered)).toThrow(NoiseError);
    expect(pair.responder.receive.decrypt(frame).toString()).toBe('tamper me');
    const next = pair.initiator.send.encrypt(Buffer.from('after'));
    expect(pair.responder.receive.decrypt(next).toString()).toBe('after');
  });

  it('refuses a transport frame shorter than its tag', () => {
    const pair = handshake();
    expect(() => pair.responder.receive.decrypt(Buffer.alloc(15))).toThrow(NoiseError);
  });
});
