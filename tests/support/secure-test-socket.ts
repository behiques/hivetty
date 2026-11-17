import { EventEmitter } from 'node:events';

import { WebSocket } from 'ws';

import { initiate, pskOfToken, type SecureSocket } from '../../electron/remote-channel/secure-socket';

/**
 * A test client that speaks the encrypted channel (HIVE-428) behind the slice of `ws`'s
 * `WebSocket` API the listener suites already use: `'open'`, `send(text)`, `'message'` with the
 * decrypted text as a Buffer, `'close'` with its code, `'error'`, `readyState`, `close`,
 * `terminate`.
 *
 * The channel is keyed from `credentials` when given, otherwise from the first frame sent: its
 * `deviceId` and `token`. That keeps every attach case reading as the attach it sends, while a
 * case that sends a malformed attach on a good channel names the channel's credentials outright.
 *
 * Every frame the server sends after the handshake is recorded in `framesAfterHandshake` with its
 * `isBinary`, so "no text frame ever reaches an attached socket" is asserted, not assumed.
 */
export class SecureTestSocket extends EventEmitter {
  static readonly OPEN = WebSocket.OPEN;
  readonly OPEN = WebSocket.OPEN;
  readonly raw: WebSocket;
  /** What `initiate` resolved, once it has. */
  outcome: 'secure' | 'plaintext' | 'refused' | null = null;
  /** The plaintext the server answered the hello with, when it answered in text. */
  plaintextReply: string | null = null;
  readonly framesAfterHandshake: { isBinary: boolean }[] = [];
  private channel: SecureSocket | null = null;
  private handshaking = false;
  private readonly queued: string[] = [];

  constructor(
    url: string,
    options: { headers?: Record<string, string>; credentials?: { deviceId: string; token: string } } = {},
  ) {
    super();
    this.credentials = options.credentials ?? null;
    this.raw = new WebSocket(url, { headers: options.headers ?? {} });
    this.raw.on('open', () => this.emit('open'));
    this.raw.on('close', (code: number) => this.emit('close', code));
    this.raw.on('error', (cause: Error) => this.emit('error', cause));
  }

  private readonly credentials: { deviceId: string; token: string } | null;

  get readyState(): number {
    return this.raw.readyState;
  }

  send(text: string): void {
    if (this.channel !== null) {
      this.channel.send(text);
      return;
    }
    this.queued.push(text);
    if (this.handshaking) return;
    this.handshaking = true;
    const { deviceId, token } = this.credentials ?? credentialsOf(text);
    void initiate(this.raw, { deviceId, psk: pskOfToken(token) }).then((outcome) => {
      this.outcome = outcome.kind;
      if (outcome.kind === 'plaintext') {
        this.plaintextReply = outcome.text;
        this.emit('message', Buffer.from(outcome.text, 'utf8'), false);
        return;
      }
      if (outcome.kind === 'refused') return;
      this.raw.on('message', (_data, isBinary) => this.framesAfterHandshake.push({ isBinary }));
      const channel = outcome.socket;
      this.channel = channel;
      channel.onMessage((received) => this.emit('message', Buffer.from(received, 'utf8'), true));
      for (const pending of this.queued.splice(0)) channel.send(pending);
    });
  }

  close(code?: number): void {
    this.raw.close(code);
  }

  terminate(): void {
    this.raw.terminate();
  }
}

function credentialsOf(text: string): { deviceId: string; token: string } {
  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch {
    frame = null;
  }
  const candidate = (frame ?? {}) as Record<string, unknown>;
  return {
    deviceId: typeof candidate.deviceId === 'string' && candidate.deviceId !== '' ? candidate.deviceId : 'no-device',
    token: typeof candidate.token === 'string' ? candidate.token : '',
  };
}

/** Completes the handshake on an already-open raw socket, for the cases that hold silent sockets first. */
export async function secureOn(socket: WebSocket, deviceId: string, token: string): Promise<SecureSocket> {
  const outcome = await initiate(socket, { deviceId, psk: pskOfToken(token) });
  if (outcome.kind !== 'secure') throw new Error(`the handshake ended ${outcome.kind}`);
  return outcome.socket;
}
