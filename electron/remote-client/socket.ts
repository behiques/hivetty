import { lookup as dnsLookup } from 'node:dns';
import type { LookupFunction } from 'node:net';

import { WebSocket, type ClientOptions } from 'ws';

import { isRemoteTarget } from '@shared/config-contract';
import type { Channel } from '@shared/ipc-contract';
import { RELAY_CLOSE, RELAY_PATH, relaySocketUrl } from '@shared/relay-contract';
import {
  ATTACH_FRAME_MAX_BYTES,
  CALL_GIVE_UP_MS,
  CALL_TIMEOUT_CODE,
  POST_ATTACH_FRAME_MAX_BYTES,
  frameKindOf,
  type AttachAccepted,
  type AttachRefused,
  type CallFrame,
  type NotifyFrame,
  type ResumePoint,
  type ServerFrame,
} from '@shared/remote-contract';

import {
  CHANNEL_CLOSE_CODE,
  CHANNEL_TAG_BYTES,
  initiate,
  pskOfToken,
  type SecureSocket,
} from '../remote-channel/secure-socket';

import { attachRequest } from './index';

/**
 * The socket half of the client (HIVE-144): open the connection, perform the
 * attach handshake, correlate `result` and `error` frames back to the `call`
 * that is waiting for them, and fan `event` frames out to whoever subscribed.
 *
 * The mirror of `electron/remote-host/listener.ts`, and deliberately only that.
 * It knows nothing about sessions, the store, or what any channel means — it
 * moves frames. `electron/main/**`'s router is what gives them meaning.
 *
 * ## The channel, and the two fences
 *
 * Every attach runs inside an end-to-end encrypted channel (HIVE-428,
 * `electron/remote-channel/`): a Noise NNpsk0 handshake keyed by a fresh
 * X25519 exchange and the device's pairing secret, then AES-256-GCM on every
 * frame. The device credential (`electron/remote-client/token-store.ts`) only
 * ever crosses inside it, and a peer that does not hold the pairing secret
 * cannot complete the handshake.
 *
 * The fences now keep a direct dial on a private network; the relay is the
 * only route off one. They fail closed independently:
 *
 * 1. **The string.** {@link isRemoteTarget} on `host`, before a socket object
 *    exists at all: loopback, the local network, or a Tailscale address.
 *
 * 2. **The resolved address.** A name such as `mini.local` or
 *    `mini.tail1234.ts.net` satisfies (1) as a *string*, and is then handed to
 *    whatever resolver the OS has, which can answer it with a public address.
 *    **No string-level predicate can see that**, because the string is genuinely
 *    a private name; the address behind it is the thing that changed. So a
 *    custom `lookup` is passed down to `net.createConnection` and re-runs the
 *    same predicate on the address DNS actually returned, refusing before the
 *    TCP connection is made.
 *
 * `ws` forwards unknown options straight into `http.request`, which forwards
 * them into `net.createConnection`, and `lookup` survives that trip — verified
 * against `ws@8.21.3` on Node 22 rather than assumed: a `lookup` that answers
 * `127.0.0.1` for a name with no DNS record connects, and one that calls back
 * with an error fails the connection carrying that error's message. An IP
 * literal host never consults `lookup` at all, which is correct and costs
 * nothing: fence (1) has already read that literal directly.
 *
 * **`family: 4` is part of fence (2), not a performance tweak.** It pins
 * `dns.lookup` to A records, so every address the fence inspects is a dotted
 * quad — the spelling `isLoopbackHost` and `isTailnetHost` are written in.
 * Without it a dual-stack answer arrives as a mixed A/AAAA array and the fence
 * would have to either refuse the whole answer (breaking every IPv6-capable
 * host) or skip the AAAA entries (a hole). Tailscale assigns every node a
 * `100.64.0.0/10` IPv4 and `localhost` resolves to `127.0.0.1` everywhere, so
 * nothing reachable is lost. An IPv6 answer that arrives anyway — a resolver
 * that ignores `family` — is refused, because these predicates cannot vouch for
 * one and refusing is the failing-closed direction.
 */

/**
 * How long {@link connectRemote} may spend getting from "no socket" to an
 * `attach-accepted` frame before it gives up (HIVE-144 review, I5).
 *
 * **Nothing bounded this.** `ClientOptions` carried `family`, `lookup` and
 * `maxPayload` and no timeout, and nothing armed a timer: the promise settled
 * only on a frame, an error or a close. The PR called the wait "bounded by the
 * handshake timeout", but that is `ATTACH_HANDSHAKE_TIMEOUT_MS` on the
 * **server**, which only exists once the far end is a Hive that has answered.
 * Two real addresses are not:
 *
 * - a tailnet host that is simply off costs the OS TCP connect timeout, about
 *   75 s on macOS;
 * - a host running some *other* TCP service on 7434 accepts the connection and
 *   never speaks HTTP, and the dial **hangs indefinitely**.
 *
 * `switchIpcMode` awaits this after `unbindEverything()`, so for the whole of
 * that wait the window has no bound channels at all — an app that looks alive
 * and answers nothing, which is precisely the state the ordering in that
 * function exists to make brief.
 *
 * Ten seconds: long enough for a sleeping tailnet peer to wake and complete a
 * WireGuard handshake, short enough that a person watching the pane's
 * "Attaching…" reads it as a failure rather than a freeze. Comfortably above
 * the server's own 5 s attach deadline, so a Hive that is going to refuse gets
 * to say so in its own words rather than being cut off and reported as a
 * generic timeout.
 *
 * Enforced twice, because the two halves fail differently. `handshakeTimeout`
 * is `ws`'s own and covers TCP connect plus the HTTP upgrade response — the
 * two cases above. The timer below covers what `ws` stops watching after the
 * upgrade: a peer that speaks WebSocket, accepts the attach frame, and never
 * answers it.
 */
export const CLIENT_ATTACH_TIMEOUT_MS = 10_000;

/**
 * An address a direct attach will not dial, from either fence (HIVE-428).
 *
 * One class, two messages, deliberately: the caller's remedy is the same —
 * check the address, or reach the server through the relay — and the
 * distinction between "the name is wrong" and "the name resolved somewhere
 * wrong" belongs in the sentence a human reads, not in a code a `catch`
 * branches on. The messages are distinguishable, and the tests assert on them.
 */
export class AddressRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressRefusedError';
  }
}

/** What a server from before the encrypted channel is told it is (HIVE-428). */
export const SERVER_TOO_OLD_MESSAGE =
  'The server is on an older HiveTTY that does not speak the encrypted channel. Update the server.';

/** What a server that would not complete the channel handshake means (HIVE-428). */
export const PAIRING_REFUSED_MESSAGE =
  "The server did not accept this device's pairing: the token is wrong or the device is unknown there. Pair again.";

/**
 * The server answered the channel's hello in text (HIVE-428): it predates the channel.
 *
 * Never a credential problem, whatever that text said. An old server reads the binary hello as a
 * malformed attach and refuses it as `unauthorized`; reading that as "pair again" would send the
 * user to fix the one thing that is not broken.
 */
export class ServerTooOldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerTooOldError';
  }
}

/**
 * The server would not complete the channel handshake (HIVE-428): it closed with
 * `CHANNEL_CLOSE_CODE` and no message 2, or its message 2 did not verify. A wrong token and an
 * unknown device id look identical from here on purpose, and both are cured by pairing again.
 */
export class PairingRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingRefusedError';
  }
}

/** A handshake the server refused, with the code it refused it with. */
export class AttachRefusedError extends Error {
  readonly code: AttachRefused['code'];

  constructor(code: AttachRefused['code'], message: string) {
    super(message);
    this.name = 'AttachRefusedError';
    this.code = code;
  }
}

/**
 * An attach frame this client refused to send, because the server would refuse
 * it as `unauthorized` and the caller would read that as a bad credential.
 *
 * Its own class rather than a bare `Error` for exactly that reason: "pair
 * again" is the wrong remedy for a `resumeFrom` that outgrew the ceiling, and a
 * settings pane needs to be able to tell the two apart.
 */
export class AttachFrameTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachFrameTooLargeError';
  }
}

/** Where a dial goes (HIVE-429): straight to a private address, or to this person's server through the relay. */
export type RemoteTarget =
  | { kind: 'direct'; host: string; port: number }
  | { kind: 'relay'; serverId: string; cloudUrl: string; accessToken: string };

export const RELAY_SERVER_OFFLINE = 'The server is offline.';

/** The relay's own verdicts on a client socket. 1001 and 1012 are ordinary drops and are not here. */
const RELAY_CLOSE_MESSAGE: Partial<Record<number, string>> = {
  [RELAY_CLOSE.unauthorized]: 'Sign in again to use the relay.',
  [RELAY_CLOSE.notEntitled]: 'Your plan does not include the relay.',
  [RELAY_CLOSE.notFound]: RELAY_SERVER_OFFLINE,
  [RELAY_CLOSE.acceptTimeout]: 'The server did not answer through the relay in time.',
  [RELAY_CLOSE.rateLimited]: 'The relay is limiting new connections.',
};

/** The relay closed a client socket with one of its own codes (HIVE-429). */
export class RelayClosedError extends Error {
  readonly code: number;

  constructor(code: number) {
    super(RELAY_CLOSE_MESSAGE[code] ?? 'The relay closed the connection.');
    this.name = 'RelayClosedError';
    this.code = code;
  }
}

/** A relay target no socket may be opened for: the cloud base or the server id is not usable. */
export class RelayTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayTargetError';
  }
}

/**
 * A `call` that came back as an `error` frame, or that this client gave up on.
 *
 * The code crosses the wire intact for the reason `ErrorFrame` states: the
 * explorer and the editor branch on `EOUTSIDE` versus `IpcValidationError`,
 * and flattening either to a message would delete behaviour that works today.
 */
export class RemoteCallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RemoteCallError';
    this.code = code;
  }
}

/**
 * Whether a dead connection is worth dialling again (HIVE-150).
 *
 * `transport` is the connection itself failing — the far machine is rebooting,
 * asleep, or off the tailnet — and another dial is exactly the right response.
 * `terminal` is a refusal whose cause the next dial would reproduce: the same
 * credential, the same protocol number, the same oversized frame. Retrying one
 * of those is a loop that cannot converge, and worse, it would leave the pane
 * saying "reconnecting" about something that is never going to reconnect.
 */
type CloseKind = 'transport' | 'terminal';

/** Why a connection ended, in the terms the reconnect loop branches on. */
export interface CloseCause {
  kind: CloseKind;
  /**
   * The server's own refusal code where there is one (`unauthorized`,
   * `revoked`, `protocol-mismatch`), this side's where it refused first
   * (`address-refused`, `attach-frame-too-large`, `server-too-old`, `relay-target`), the relay's
   * (`relay-sign-in`, `relay-locked`, `relay-server-offline`, HIVE-429), or `transport`.
   */
  code: string;
  message: string;
}

/**
 * Classifies a dead connection for {@link CloseCause}.
 *
 * Exported because the reconnect loop classifies **two** things with it and
 * only one of them is a close: a live socket's `onClose`, and the rejection a
 * failed *dial* produces — which never reaches `onClose` at all, because there
 * was no attached client to hear it. One table for both, so a refusal cannot be
 * terminal on one path and retryable on the other.
 *
 * Takes `unknown` because a rejected promise carries whatever was thrown.
 */
export function classifyCause(cause: unknown): CloseCause {
  if (cause instanceof AttachRefusedError) {
    return { kind: 'terminal', code: cause.code, message: cause.message };
  }
  if (cause instanceof AddressRefusedError) {
    return { kind: 'terminal', code: 'address-refused', message: cause.message };
  }
  // The same cure as an `attach-refused: unauthorized`, so the same code and the same pane.
  if (cause instanceof PairingRefusedError) {
    return { kind: 'terminal', code: 'unauthorized', message: cause.message };
  }
  if (cause instanceof ServerTooOldError) {
    return { kind: 'terminal', code: 'server-too-old', message: cause.message };
  }
  if (cause instanceof AttachFrameTooLargeError) {
    return { kind: 'terminal', code: 'attach-frame-too-large', message: cause.message };
  }
  if (cause instanceof RelayTargetError) {
    return { kind: 'terminal', code: 'relay-target', message: cause.message };
  }
  if (cause instanceof RelayClosedError) {
    // Another dial is answered the same way: the account, or the plan.
    if (cause.code === RELAY_CLOSE.unauthorized) {
      return { kind: 'terminal', code: 'relay-sign-in', message: cause.message };
    }
    if (cause.code === RELAY_CLOSE.notEntitled) {
      return { kind: 'terminal', code: 'relay-locked', message: cause.message };
    }
    // Retried: after a relay restart this client may redial before the server is serving again.
    if (cause.code === RELAY_CLOSE.notFound) {
      return { kind: 'transport', code: 'relay-server-offline', message: cause.message };
    }
    return { kind: 'transport', code: 'transport', message: cause.message };
  }
  return {
    kind: 'transport',
    code: 'transport',
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

/**
 * How many `event` frames are held for a subscriber that has not arrived yet
 * (HIVE-150).
 *
 * The server sends `attach-accepted` and then, **synchronously, before its own
 * turn ends**, runs the resume replay into the same socket
 * (`remote-host/listener.ts`). `ws` parses a chunk in a synchronous loop and
 * emits one `'message'` per frame with that stack still live, so those frames
 * reach this module before anything can subscribe: `resolveConnection` only
 * queues a microtask, and the caller that eventually calls `onEvent` runs in
 * it. Without a buffer they are fanned out to an empty listener set and
 * silently lost — which is the resume feature failing while reporting success.
 *
 * Sized generously against what one attach can legitimately replay, and bounded
 * because a server is not obliged to stop: a ring, keeping the **newest**. A
 * client that fell this far behind before it even subscribed is taking a gap
 * notice regardless, and the recent frames are the ones its terminal needs.
 */
export const PRE_SUBSCRIBE_BUFFER = 2_048;

export interface RemoteClient {
  /** Invoke a call channel. Rejects on an error frame or the give-up deadline. */
  call(channel: Channel, payload: unknown): Promise<unknown>;
  /** Fire a notify channel. Never awaits. */
  notify(channel: Channel, payload: unknown): void;
  /** Subscribe to every event frame. Returns an unsubscribe. */
  onEvent(listener: (channel: Channel, payload: unknown) => void): () => void;
  /**
   * Subscribe to this connection ending. Fires **once**, after every pending
   * call has been rejected. Returns an unsubscribe (HIVE-150).
   *
   * Once, because `ws` emits `'error'` and then `'close'` for a connection that
   * dies rather than one closed politely, and a listener that heard both would
   * start two reconnect loops against one drop.
   *
   * After the rejections, because the listener's first act is to dial again:
   * a caller still holding an unsettled promise at that moment would outlive
   * the client that owed it an answer.
   */
  onClose(listener: (cause: CloseCause) => void): () => void;
  /** The snapshot the server sent with AttachAccepted. */
  snapshot(): Readonly<Partial<Record<Channel, unknown>>>;
  /** The name this client paired under, for the header chip. */
  serverName(): string;
  close(): void;
}

export interface ConnectRemoteDeps {
  /** A private address, fenced; or this person's server through the relay (HIVE-429), not fenced. */
  target: RemoteTarget;
  credential: { deviceId: string; token: string };
  resumeFrom?: Readonly<Record<string, ResumePoint>>;
  /** Injectable purely so a unit test needs no socket. Defaults to `ws`'s. */
  WebSocketCtor?: typeof WebSocket;
  /**
   * The resolver the address fence consults, defaulting to `node:dns`'s
   * `lookup` — injectable for the same reason `WebSocketCtor` is, and for one
   * more: a test cannot make the real resolver answer a `.ts.net` name with an
   * address of its choosing, which is exactly the attack fence (2) exists to
   * stop. Substituting it is how that fence gets exercised against a real `ws`
   * client rather than asserted about in isolation.
   */
  resolveAddress?: LookupFunction;
}

/** What one outstanding `call` is waiting on. */
interface Pending {
  resolve: (payload: unknown) => void;
  reject: (cause: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The `lookup` handed to `net.createConnection`, wrapping `resolve` with fence
 * (2).
 *
 * `refuse` is a sink rather than a return value because this callback's error
 * does not come back to the caller as itself: `net` hands it to the socket,
 * `ws` re-emits it as an `'error'` event, and by then the identity of the
 * `Error` is not something this file should be relying on. Recording the
 * refusal where `connectRemote` can read it means the promise rejects with the
 * sentence that names the address, not with `ECONNREFUSED`.
 */
function fencedLookup(
  host: string,
  resolve: LookupFunction,
  refuse: (cause: AddressRefusedError) => void,
): LookupFunction {
  return (hostname, options, callback) => {
    /*
      Answered once, whatever the resolver does (HIVE-144 review).

      `resolveAddress` is an injectable dependency, and a resolver that called
      back twice — a refused answer, then a good one — would run this body
      twice: the refusal is recorded, and a second `callback(null, address)`
      still goes out and the connection proceeds. `node:dns` does not do that,
      but every other fence in this file is fail-closed by construction rather
      than by trusting its caller, and this one should be too.
    */
    let answered = false;
    resolve(hostname, options, (error, address, family) => {
      if (answered) return;
      answered = true;
      if (error !== null) {
        callback(error, '', 4);
        return;
      }
      // `dns.lookup` answers with an array when `options.all` is set and a bare
      // string otherwise, and which one arrives is Node's choice, not ours —
      // `family: 4` takes the bare-string path today, and `all` is set when a
      // family is not pinned. Both are normalised here so the fence reads every
      // address in the answer either way.
      const answers = Array.isArray(address) ? address : [{ address, family: family ?? 4 }];
      const offending = answers.find((answer) => !isRemoteTarget(answer.address));
      if (offending !== undefined) {
        const cause = new AddressRefusedError(
          `Refusing to attach directly to "${host}": it resolved to ` +
            `${offending.address}, which is not loopback, on the local network, or a ` +
            `Tailscale address. Check the address, or reach a server elsewhere with ` +
            `"Connect through relay".`,
        );
        refuse(cause);
        callback(cause, '', 4);
        return;
      }
      // Passed through exactly as it arrived, so `net` sees the shape it asked
      // for. This function's job is to inspect the answer, not to rewrite it.
      (callback as (e: Error | null, a: typeof address, f?: number) => void)(null, address, family);
    });
  };
}

/**
 * How many bytes a frame actually weighs on the wire — UTF-8, not UTF-16.
 *
 * Exported since HIVE-150 so that whatever *builds* a `resumeFrom` measures it
 * with the same function that later refuses it. Two measurements would be one
 * defect waiting: a composer that fitted the map under the ceiling by its own
 * arithmetic, and a client that then weighed the real frame and threw.
 *
 * It cannot live in `electron/shared/` beside `ATTACH_FRAME_MAX_BYTES`, where
 * it otherwise belongs — that module may not reach a Node API, and `Buffer` is
 * one.
 */
export function frameBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function connectRemote(deps: ConnectRemoteDeps): Promise<RemoteClient> {
  const { target, credential, resumeFrom, WebSocketCtor = WebSocket, resolveAddress = dnsLookup } = deps;
  /** How messages name the far end: an address for a direct dial, never one for the relay. */
  const label =
    target.kind === 'direct' ? `${target.host}:${String(target.port)}` : 'the server through the relay';

  let url: string;
  if (target.kind === 'direct') {
    /*
      Fence (1), before a socket object exists. The brief's first test asserts
      `WebSocketCtor` was never called, and that assertion is the point: a
      refusal that costs a TCP connection has already told an attacker this
      machine is here and looking for a Hive.
    */
    if (!isRemoteTarget(target.host)) {
      return Promise.reject(
        new AddressRefusedError(
          `Refusing to attach directly to "${target.host}": it is not loopback, on the ` +
            `local network, or a Tailscale address. A server elsewhere is reached ` +
            `with "Connect through relay".`,
        ),
      );
    }
    url = `ws://${target.host}:${String(target.port)}/`;
  } else {
    // The address fences are for a direct dial. A relay dial goes to the cloud base over TLS and nowhere else.
    try {
      url = relaySocketUrl(target.cloudUrl, RELAY_PATH.attach(target.serverId));
    } catch (cause) {
      return Promise.reject(
        new RelayTargetError(
          `Cannot attach through the relay: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
      );
    }
  }

  return new Promise<RemoteClient>((resolveConnection, rejectConnection) => {
    let refusal: AddressRefusedError | null = null;

    /*
      `lookup` is absent from `@types/ws`'s `ClientOptions`, which models the
      options `ws` reads itself and not the ones it forwards. It forwards
      everything it does not recognise into `http.request`, and from there into
      `net.createConnection`, where `lookup` is a documented option — verified
      against `ws@8.21.3` on Node 22, not assumed. The intersection is the
      narrowest way to say that: `lookup` is declared here, so the object
      literal type-checks, and every other key is still checked against `ws`'s
      own option type rather than escaping through a cast of the whole thing.
    */
    const shared = {
      // Every frame is a Noise transport message: its plaintext, then a 16-byte tag (HIVE-428).
      maxPayload: POST_ATTACH_FRAME_MAX_BYTES + CHANNEL_TAG_BYTES,
      /*
        `ws`'s own, covering TCP connect and the HTTP upgrade response
        (HIVE-144 review, I5). This is the half that stops the two hangs:
        a host that is off, which otherwise costs the OS connect timeout, and
        one running something else on this port that accepts and never speaks
        HTTP, which otherwise never returns at all. See
        {@link CLIENT_ATTACH_TIMEOUT_MS}.
      */
      handshakeTimeout: CLIENT_ATTACH_TIMEOUT_MS,
    };
    const options: ClientOptions & { lookup?: LookupFunction } =
      target.kind === 'direct'
        ? {
            ...shared,
            family: 4,
            lookup: fencedLookup(target.host, resolveAddress, (cause) => {
              refusal = cause;
            }),
          }
        : // The token goes only to the URL `relaySocketUrl` built from the cloud base (HIVE-429).
          { ...shared, headers: { authorization: `Bearer ${target.accessToken}` } };

    const socket = new WebSocketCtor(url, options);

    /** Cleared once the handshake settles, so a later failure is not a double-settle. */
    let handshakeSettled = false;
    /** The client, once `attach-accepted` has built it. */
    let attached: {
      accepted: AttachAccepted;
      pending: Map<string, Pending>;
      listeners: Set<(channel: Channel, payload: unknown) => void>;
      /**
       * Events that arrived before anything subscribed — see
       * {@link PRE_SUBSCRIBE_BUFFER}. `null` once the first subscriber has taken
       * them, which is what keeps this a handover rather than a log: a later
       * subscriber must not be handed output the terminal already rendered.
       */
      early: { channel: Channel; payload: unknown }[] | null;
    } | null = null;
    let closed = false;
    /** The encrypted channel, once message 2 verified (HIVE-428). Every frame after the hello goes through it. */
    let channel: SecureSocket | null = null;
    /** True from the hello until `initiate` settles: a 1008 close in that window is a refused pairing. */
    let initiating = false;

    /**
     * Subscribers to this connection ending, and the guard that keeps the
     * notification to one (HIVE-150).
     *
     * The guard is separate from `closed` on purpose: `closed` is also set by
     * `close()`, and it answers "may this client still be used", which `call`
     * reads on every invocation. This one answers "has the ending already been
     * announced", which is asked exactly twice and only by the two handlers.
     */
    const closeListeners = new Set<(cause: CloseCause) => void>();
    let closeAnnounced = false;

    /** Announces the ending to {@link closeListeners}, once. */
    const announceClose = (cause: unknown): void => {
      if (closeAnnounced) return;
      closeAnnounced = true;
      const classified = classifyCause(cause);
      for (const listener of closeListeners) {
        /*
          Guarded per listener for the reason the event fan-out is: this runs
          inside `ws`'s own emit, so a subscriber that throws would propagate
          out of the EventEmitter as an uncaught exception in the main process
          — and the subscriber here is the reconnect loop, whose failure would
          take the app down rather than merely lose a reconnect.
        */
        try {
          listener(classified);
        } catch {
          // A subscriber's own failure is its own, and there is no channel back
          // to one that has already failed.
        }
      }
      closeListeners.clear();
    };

    /**
     * The whole-handshake deadline (HIVE-144 review, I5).
     *
     * Armed before the socket has done anything and cleared by
     * {@link failHandshake} or by the accept, so it covers every step from
     * "no connection" to "attached" — including the one `handshakeTimeout`
     * stops watching, which is a peer that completed the WebSocket upgrade,
     * took the attach frame, and never answered it.
     *
     * `terminate()` rather than `close()`: a graceful close is a frame this
     * peer has already shown it may not answer, and waiting on it would
     * reintroduce the hang the deadline exists to end.
     */
    const deadline = setTimeout(() => {
      failHandshake(
        new Error(
          `${target.kind === 'direct' ? label : 'The server through the relay'} did not complete the attach handshake within ` +
            `${String(CLIENT_ATTACH_TIMEOUT_MS)}ms. It may not be a Hive, or it may not be ` +
            `reachable from here.`,
        ),
      );
      socket.terminate();
    }, CLIENT_ATTACH_TIMEOUT_MS);

    const failHandshake = (cause: Error): void => {
      if (handshakeSettled) return;
      handshakeSettled = true;
      clearTimeout(deadline);
      rejectConnection(cause);
    };

    /**
     * Rejects every outstanding call and clears its timer.
     *
     * Called on `close` — without it a detach leaves every caller awaiting a
     * promise nothing will ever settle, which is a hang rather than an error
     * and is the failure mode the map exists to make impossible.
     */
    const failAllPending = (cause: Error): void => {
      if (attached === null) return;
      for (const waiting of attached.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(cause);
      }
      attached.pending.clear();
    };

    socket.on('open', () => {
      const frame = JSON.stringify(
        attachRequest(credential.deviceId, credential.token, resumeFrom),
      );
      /*
        The attach frame is the one client-sent frame `sendBounded` never sees,
        and the only one with an unbounded shape (HIVE-144 review). `deviceId`,
        `token` and `protocol` are fixed; `resumeFrom` is one `{ gen, seq }` per
        tracked session, roughly forty bytes each, so a few hundred sessions
        reaches the server's `ATTACH_FRAME_MAX_BYTES` on its own — and the
        snapshot HIVE-144's later tasks put behind this handshake only grows it.

        Unbounded, the server answers `unauthorized('The first frame on a
        connection is too large.')`, which is indistinguishable at this end from
        a bad credential: a settings pane would tell the user to pair again over
        a problem pairing cannot fix. It fails closed either way, so this is
        diagnosability rather than a hole — but naming the real cause costs one
        comparison, and it is checked *before* the frame goes out so the socket
        is not spent proving something this side already knew.
      */
      const weight = frameBytes(frame);
      if (weight > ATTACH_FRAME_MAX_BYTES) {
        const sessions = resumeFrom === undefined ? 0 : Object.keys(resumeFrom).length;
        failHandshake(
          new AttachFrameTooLargeError(
            `The attach frame is ${String(weight)} bytes, over the ` +
              `${String(ATTACH_FRAME_MAX_BYTES)}-byte handshake ceiling, carrying resume ` +
              `points for ${String(sessions)} sessions. This is not a credential problem — ` +
              `the server would refuse it as "unauthorized" and mean this. Reattach with ` +
              `fewer resume points.`,
          ),
        );
        socket.close();
        return;
      }

      /*
        The channel first (HIVE-428): the hello, then message 2, and only then
        the attach, inside it. The size check above runs before the hello, so a
        frame this side already knows is too large never spends a handshake.
      */
      initiating = true;
      void initiate(socket, { deviceId: credential.deviceId, psk: pskOfToken(credential.token) })
        .then((outcome) => {
          initiating = false;
          if (outcome.kind === 'plaintext') {
            failHandshake(new ServerTooOldError(SERVER_TOO_OLD_MESSAGE));
            socket.close();
            return;
          }
          if (outcome.kind === 'refused') {
            failHandshake(new PairingRefusedError(PAIRING_REFUSED_MESSAGE));
            return;
          }
          // The deadline already failed this dial; a late message 2 must not send an attach.
          if (handshakeSettled) return;
          channel = outcome.socket;
          channel.onMessage(onFrameText);
          channel.send(frame);
        })
        .catch((cause: unknown) => {
          initiating = false;
          failHandshake(cause instanceof Error ? cause : new Error(String(cause)));
          socket.close();
        });
    });

    /** Every server frame past the handshake, decrypted. Today's handler, fed text. */
    function onFrameText(text: string): void {
      let frame: unknown;
      try {
        frame = JSON.parse(text);
      } catch {
        // A server that cannot produce JSON is not a server this client can
        // talk to; dropping the frame is right for an attached socket, and for
        // an unattached one the handshake timeout on the far end closes it.
        return;
      }
      if (typeof frame !== 'object' || frame === null || !('kind' in frame)) return;
      const server = frame as ServerFrame;

      if (attached === null) {
        if (server.kind === 'attach-accepted') {
          handshakeSettled = true;
          // The deadline covers the handshake and nothing past it — a live
          // socket's own idle time is `CALL_GIVE_UP_MS`'s business, per call.
          clearTimeout(deadline);
          const pending = new Map<string, Pending>();
          const listeners = new Set<(channel: Channel, payload: unknown) => void>();
          attached = { accepted: server, pending, listeners, early: [] };
          resolveConnection(buildClient(server, pending, listeners));
          return;
        }
        if (server.kind === 'attach-refused') {
          failHandshake(new AttachRefusedError(server.code, server.message));
          socket.close();
          return;
        }
        // Anything else before the handshake answers is a protocol violation.
        // Ignored rather than fatal: the far end still owes an accept or a
        // refusal, and its own handshake deadline closes the socket if it never
        // sends one.
        return;
      }

      if (server.kind === 'result') {
        const waiting = attached.pending.get(server.id);
        if (waiting === undefined) return;
        clearTimeout(waiting.timer);
        attached.pending.delete(server.id);
        waiting.resolve(server.payload);
        return;
      }
      if (server.kind === 'error') {
        const waiting = attached.pending.get(server.id);
        if (waiting === undefined) return;
        clearTimeout(waiting.timer);
        attached.pending.delete(server.id);
        waiting.reject(new RemoteCallError(server.code, server.message));
        return;
      }
      if (server.kind === 'event') {
        /*
          The mirror of `isClientFrameAllowed`'s direction half, pointed the
          other way (HIVE-144). That function stops a *client* sending a frame
          naming one of the event channels; this stops a *server* pushing an
          `event` naming a `call` or `notify` channel, which no honest server
          does and which a subscriber would have no way to tell from a real
          push. Derived from `FRAME_KIND` through `frameKindOf`, so it cannot
          drift from the table the server grades against.
        */
        if (frameKindOf(server.channel) !== 'event') return;
        /*
          Nobody is listening yet, and this frame is almost certainly the resume
          replay the server pushed in the accept's own tick. Held rather than
          dropped — see {@link PRE_SUBSCRIBE_BUFFER}.
        */
        if (attached.early !== null && attached.listeners.size === 0) {
          attached.early.push({ channel: server.channel, payload: server.payload });
          if (attached.early.length > PRE_SUBSCRIBE_BUFFER) attached.early.shift();
          return;
        }
        for (const listener of attached.listeners) {
          /*
            Guarded per listener (HIVE-144 review). This loop runs inside `ws`'s
            `'message'` emit, so a subscriber that throws does two things at
            once: it aborts the fan-out, silently losing the event for every
            listener registered after it, and it propagates out of the
            EventEmitter as an uncaught exception in the main process. HIVE-144's
            later tasks register the remote proxy against this fan-out and drive
            the store from it, so "one bad consumer" would mean "the app is
            gone". A subscriber's own failure is its own; it is not this socket's
            to re-raise, and it is certainly not the other subscribers'.
          */
          try {
            listener(server.channel, server.payload);
          } catch {
            // Deliberately swallowed. There is no channel back to a subscriber
            // that has already failed, and a console line per dropped frame on
            // `pty:data` would be its own denial of service.
          }
        }
      }
    }

    socket.on('error', (cause: Error) => {
      // `refusal` is fence (2) speaking: `net` gave our own error to the
      // socket and `ws` re-emitted it here, so this is where a refused
      // resolution becomes the promise's rejection reason rather than a
      // generic connect failure.
      failHandshake(refusal ?? cause);
      failAllPending(refusal ?? cause);
      // Last, so no subscriber is told the connection is over while a caller
      // is still holding a promise against it — see `RemoteClient.onClose`.
      announceClose(refusal ?? cause);
    });

    socket.on('close', (code?: number) => {
      closed = true;
      // The relay's own verdicts (HIVE-429), only on a relay socket: a direct peer's 4404 means nothing.
      const relayed =
        target.kind === 'relay' && code !== undefined && code in RELAY_CLOSE_MESSAGE
          ? new RelayClosedError(code)
          : null;
      failHandshake(
        refusal ??
          relayed ??
          /*
            A 1008 before message 2 is the server refusing the pairing (HIVE-428),
            and this listener runs before `initiate`'s own, so it names it here.
            Any other code mid-handshake is the network, and stays retryable.
          */
          (initiating && code === CHANNEL_CLOSE_CODE
            ? new PairingRefusedError(PAIRING_REFUSED_MESSAGE)
            : new Error(`The connection to ${label} closed before it attached.`)),
      );
      const ending = relayed ?? new Error(`The connection to ${label} closed.`);
      failAllPending(ending);
      announceClose(refusal ?? ending);
    });

    /**
     * Sends one client frame, refusing it rather than letting `ws` close the
     * socket over it.
     *
     * Both **post-attach** client-to-server frame kinds go through here,
     * deliberately: a `notify` over the ceiling is refused by the far end's `maxPayload`
     * exactly as a `call` is — with a 1009 close that takes every unrelated
     * in-flight correlation id with it — so bounding only the kind that has a
     * promise to reject would leave the cheaper-looking half able to kill the
     * connection. `pty:write` carrying a very large paste is the realistic way
     * that happens. The **attach** frame is bounded separately, in the `'open'`
     * handler, against the server's own and much smaller handshake ceiling: it
     * is the third client-sent frame, and the only one that has to clear 8 KiB.
     */
    const sendBounded = (frame: CallFrame | NotifyFrame): string | null => {
      const text = JSON.stringify(frame);
      const weight = frameBytes(text);
      if (weight > POST_ATTACH_FRAME_MAX_BYTES) {
        return (
          `The ${frame.kind} frame for ${frame.channel} is ${String(weight)} bytes, over the ` +
          `${String(POST_ATTACH_FRAME_MAX_BYTES)}-byte frame ceiling. The server answers a frame ` +
          `this large by closing the connection rather than by refusing the frame, so it is ` +
          `refused here instead.`
        );
      }
      // Post-attach only, so the channel exists: the accept that built this client came through it.
      channel?.send(text);
      return null;
    };

    function buildClient(
      accepted: AttachAccepted,
      pending: Map<string, Pending>,
      listeners: Set<(channel: Channel, payload: unknown) => void>,
    ): RemoteClient {
      let nextId = 0;

      return {
        call(channel, payload) {
          if (closed) {
            return Promise.reject(
              new Error(`Cannot call ${channel}: the connection to ${label} is closed.`),
            );
          }
          nextId += 1;
          const id = String(nextId);
          const frame: CallFrame = { kind: 'call', id, channel, payload };

          return new Promise<unknown>((resolvePayload, rejectPayload) => {
            const tooLarge = sendBounded(frame);
            if (tooLarge !== null) {
              rejectPayload(new RemoteCallError('frame-too-large', tooLarge));
              return;
            }
            /*
              `CALL_GIVE_UP_MS`, not `CALL_DEADLINE_MS`. The server answers its
              own timeout at the shorter number; giving up at or before that
              instant would abandon a call the server is still going to answer,
              which is the race the two constants exist as a pair to close.
            */
            const timer = setTimeout(() => {
              pending.delete(id);
              rejectPayload(
                new RemoteCallError(
                  CALL_TIMEOUT_CODE,
                  `${channel} did not answer within ${String(CALL_GIVE_UP_MS)}ms.`,
                ),
              );
            }, CALL_GIVE_UP_MS);
            pending.set(id, { resolve: resolvePayload, reject: rejectPayload, timer });
          });
        },

        notify(channel, payload) {
          /*
            Throws rather than returning quietly (HIVE-150).

            It used to `return`, which was defensible while a closed client only
            ever existed for the instant between a detach and its teardown. The
            reconnect loop makes that window a *policy*: the dead client stays
            bound for the whole backoff — deliberately, so calls reject promptly
            instead of hitting an unbound channel — and four channels are
            `notify` kind. `pty:write` is the one that matters: the terminal
            stays mounted and focused while the chip is amber, and every
            keystroke typed into it returned here before reaching the wire. The
            reattach then replays the *server's* transcript, which never
            contained them, so nothing anywhere recorded that the input existed.

            The same `RemoteCallError` `call` rejects with, so
            `remote-proxy.ts`'s notify wrapper logs it exactly as it logs a
            frame that was too large. Losing the keystroke is unavoidable — there
            is no socket — but losing it silently is not.
          */
          if (closed) {
            throw new RemoteCallError(
              'connection-closed',
              `Cannot send ${channel}: the connection to ${label} is closed.`,
            );
          }
          const tooLarge = sendBounded({ kind: 'notify', channel, payload });
          if (tooLarge !== null) throw new RemoteCallError('frame-too-large', tooLarge);
        },

        onEvent(listener) {
          const first = listeners.size === 0;
          listeners.add(listener);
          /*
            Hand the first subscriber whatever arrived before it existed, then
            drop the buffer for good. Delivered synchronously, in arrival order,
            so the resume replay reaches the terminal ahead of the live output
            that follows it — the ordering the seq numbers assume.
          */
          if (first && attached?.early != null) {
            const held = attached.early;
            attached.early = null;
            for (const event of held) {
              try {
                listener(event.channel, event.payload);
              } catch {
                // A subscriber's own failure is its own, exactly as in the
                // live fan-out below.
              }
            }
          }
          return () => listeners.delete(listener);
        },

        onClose(listener) {
          /*
            A connection that is already over never calls its new subscriber.
            The reconnect loop subscribes at the moment it takes ownership of a
            fresh client, so this can only be reached by a caller subscribing to
            a client it kept a reference to past its ending — for which the
            answer it wants is the one it already had.
          */
          if (closeAnnounced) return () => undefined;
          closeListeners.add(listener);
          return () => closeListeners.delete(listener);
        },

        snapshot() {
          return accepted.snapshot;
        },

        serverName() {
          return accepted.serverName;
        },

        close() {
          closed = true;
          socket.close();
        },
      };
    }
  });
}
