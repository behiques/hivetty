import { createHash, randomBytes } from 'node:crypto';

import { NOISE_HANDSHAKE_MESSAGE_BYTES, initiator, responder, type Transport } from './noise';

/**
 * The encrypted channel every attach runs inside (HIVE-428), over any WebSocket-shaped socket.
 *
 * The client's first frame is the hello: `"HTC1" | 0x01 | idLength | deviceId | Noise message 1`.
 * The server answers with Noise message 2, and from then on every frame is binary: one Noise
 * transport message carrying UTF-8 text. This file knows nothing of attach frames; the listener
 * and the client run today's JSON protocol inside the `SecureSocket` it returns.
 */

/** Policy violation: what a peer gets for a hello, a frame or a key that does not verify. */
export const CHANNEL_CLOSE_CODE = 1008;
/** What one transport frame adds to its plaintext: the AES-GCM tag. */
export const CHANNEL_TAG_BYTES = 16;

const MAGIC = Buffer.from('HTC1', 'ascii');
const VERSION = 1;
const HEADER_BYTES = MAGIC.length + 2;
const PROLOGUE_LABEL = Buffer.from('hivetty-remote/1', 'ascii');
const MAX_DEVICE_ID_BYTES = 255;

export interface RawSocket {
  send(data: Buffer | string): void;
  close(code?: number): void;
  terminate(): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  once(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  once(event: 'close', listener: () => void): unknown;
}

export interface SecureSocket {
  send(text: string): void;
  /** Sets the one listener. Frames that arrived before it was set are delivered first, in order. */
  onMessage(listener: (text: string) => void): void;
  close(code?: number): void;
  terminate(): void;
}

export type RespondOutcome =
  | { kind: 'secure'; socket: SecureSocket; deviceId: string }
  /** The first frame was text: an old client. */
  | { kind: 'plaintext' }
  /** Already closed. */
  | { kind: 'refused' };

export type InitiateOutcome =
  | { kind: 'secure'; socket: SecureSocket }
  /** The server answered in text: an old server. */
  | { kind: 'plaintext'; text: string }
  /** Closed with no message 2, or message 2 did not verify. */
  | { kind: 'refused' };

/** The channel's pre-shared key for a device token: the token's SHA-256, which the server stores as its digest. */
export const pskOfToken = (token: string): Buffer => createHash('sha256').update(token).digest();

const prologueFor = (deviceId: string): Buffer => Buffer.concat([PROLOGUE_LABEL, Buffer.from(deviceId, 'utf8')]);

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  return Buffer.from(data as ArrayBuffer);
}

function encodeHello(deviceId: string, noise1: Buffer): Buffer {
  const id = Buffer.from(deviceId, 'utf8');
  if (id.length === 0 || id.length > MAX_DEVICE_ID_BYTES) throw new Error('A device id must be 1 to 255 bytes.');
  return Buffer.concat([MAGIC, Buffer.from([VERSION, id.length]), id, noise1]);
}

function decodeHello(message: Buffer): { deviceId: string; noise1: Buffer } | null {
  if (message.length < HEADER_BYTES) return null;
  if (!message.subarray(0, MAGIC.length).equals(MAGIC) || message[MAGIC.length] !== VERSION) return null;
  const idLength = message[MAGIC.length + 1];
  if (idLength === 0 || message.length !== HEADER_BYTES + idLength + NOISE_HANDSHAKE_MESSAGE_BYTES) return null;
  return {
    deviceId: message.subarray(HEADER_BYTES, HEADER_BYTES + idLength).toString('utf8'),
    noise1: message.subarray(HEADER_BYTES + idLength),
  };
}

function secure(socket: RawSocket, transport: Transport): SecureSocket {
  let listener: ((text: string) => void) | null = null;
  let dead = false;
  const early: string[] = [];
  const fail = (): void => {
    dead = true;
    socket.close(CHANNEL_CLOSE_CODE);
  };
  socket.on('message', (data, isBinary) => {
    // ws keeps delivering through the closing handshake; nothing after a failure may reach the listener.
    if (dead) return;
    if (!isBinary) return fail();
    let text: string;
    try {
      text = transport.receive.decrypt(toBuffer(data)).toString('utf8');
    } catch {
      return fail();
    }
    if (listener === null) early.push(text);
    else listener(text);
  });
  return {
    send(text) {
      socket.send(transport.send.encrypt(Buffer.from(text, 'utf8')));
    },
    onMessage(next) {
      listener = next;
      for (const text of early.splice(0)) next(text);
    },
    close: (code) => socket.close(code),
    terminate: () => socket.terminate(),
  };
}

/** The server half: reads exactly one frame, the hello, and answers message 2 or closes. */
export function respond(
  socket: RawSocket,
  { pskFor }: { pskFor(deviceId: string): Buffer | null },
): Promise<RespondOutcome> {
  return new Promise((resolve) => {
    // A promise that has resolved ignores later calls, so this listener is safe to leave attached.
    socket.once('close', () => resolve({ kind: 'refused' }));
    socket.once('message', (data, isBinary) => {
      if (!isBinary) return resolve({ kind: 'plaintext' });
      const refuse = (): void => {
        socket.close(CHANNEL_CLOSE_CODE);
        resolve({ kind: 'refused' });
      };
      const hello = decodeHello(toBuffer(data));
      if (hello === null) return refuse();
      try {
        // An unknown id gets a random key, so it fails exactly where a wrong token does.
        const psk = pskFor(hello.deviceId) ?? randomBytes(32);
        const handshake = responder({ prologue: prologueFor(hello.deviceId), psk });
        handshake.readMessage1(hello.noise1);
        const { message, transport } = handshake.writeMessage2();
        // secure() registers its message listener before message 2 leaves, so the attach frame cannot be missed.
        const channel = secure(socket, transport);
        socket.send(message);
        resolve({ kind: 'secure', socket: channel, deviceId: hello.deviceId });
      } catch {
        refuse();
      }
    });
  });
}

/** The client half: sends the hello and reads exactly one frame. Rejects for a device id of 0 or over 255 bytes. */
export function initiate(
  socket: RawSocket,
  { deviceId, psk }: { deviceId: string; psk: Buffer },
): Promise<InitiateOutcome> {
  return new Promise((resolve) => {
    const handshake = initiator({ prologue: prologueFor(deviceId), psk });
    // Built before any listener, so a bad id rejects with nothing sent and nothing attached.
    const hello = encodeHello(deviceId, handshake.writeMessage1());
    socket.once('close', () => resolve({ kind: 'refused' }));
    socket.once('message', (data, isBinary) => {
      if (!isBinary) return resolve({ kind: 'plaintext', text: toBuffer(data).toString('utf8') });
      try {
        const { transport } = handshake.readMessage2(toBuffer(data));
        resolve({ kind: 'secure', socket: secure(socket, transport) });
      } catch {
        socket.close(CHANNEL_CLOSE_CODE);
        resolve({ kind: 'refused' });
      }
    });
    socket.send(hello);
  });
}
