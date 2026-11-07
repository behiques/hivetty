import { createHash, generateKeyPairSync } from 'node:crypto';

import type { AccountState, DeviceCode, OpenWebResult, SignedOutReason, SignInResult } from '@shared/account-contract';

import { isSafeExternalUrl } from '../external-links';

import { type AccountStore, type DeviceKey, NO_ENCRYPTION, type StoredAccount } from './account-store';
import { type Cloud, CloudError, stringField, type TokenResponse } from './cloud';
import { parseCallback, redirectUriFor, type Scheme } from './deep-link';
import { DeviceFlowError, type DeviceFlowFailure, type DeviceFlowInput } from './device-flow';

/**
 * Signing in to the HiveTTY cloud (HIVE-264): PKCE in the system browser, the deep-link callback, and
 * rotating refresh tokens. Pure: every effect is injected. The refresh token and device key live in
 * `account.bin`; the access token and the PKCE verifier live only in this closure.
 */

export const SIGN_IN_DEADLINE_MS = 10 * 60_000;
export const REFRESH_LEAD_MS = 60_000;
export const BACKOFF_START_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export interface AuthClientDeps {
  cloud: Cloud;
  store: AccountStore;
  encryptionAvailable: () => boolean;
  openExternal: (url: string) => Promise<void>;
  hostname: () => string;
  randomBytes: (size: number) => Buffer;
  generateDeviceKey: () => DeviceKey;
  scheme: Scheme;
  /** HIVE-266: the device flow, bound to this client's cloud. */
  runDeviceFlow: (input: DeviceFlowInput) => Promise<TokenResponse>;
}

export interface AuthClient {
  state(): AccountState;
  onChange(listener: (state: AccountState) => void): () => void;
  /** At launch: a stored account is signed in at once, then refreshed. */
  start(): void;
  signIn(): Promise<SignInResult>;
  /** HIVE-266: sign in with a code typed on another device. Resolves when the flow ends; the state follows. */
  signInWithCode(opts: { onCode: (code: DeviceCode) => void; signal?: AbortSignal }): Promise<CodeSignInResult>;
  cancel(): void;
  handleCallback(url: string): Promise<void>;
  signOut(): Promise<void>;
  /** A token with more than a minute left, refreshing if needed; `null` when signed out or offline. */
  getAccessToken(): Promise<string | null>;
  /** A cloud call with the bearer token; a `device_revoked` 401 signs this device out. */
  authedFetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * HIVE-268: open `path` of the account site, signed in through a one-time link (`POST /api/oauth/web-session`).
   * `path` is `unknown` because it crosses IPC. Never throws: every failure is a sentence in `{ error }`.
   */
  openWeb(path: unknown): Promise<OpenWebResult>;
}

export type CodeSignInResult = { ok: true } | { error: string; failure: DeviceFlowFailure | 'storage' };

const FLOW_MESSAGES: Record<DeviceFlowFailure, string> = {
  denied: 'The sign-in was denied.',
  expired: 'The code expired before it was approved.',
  network: "Couldn't reach HiveTTY.",
  refused: 'HiveTTY refused the sign-in.',
  aborted: 'Sign-in cancelled.',
};

/** The longest `next` path `openWeb` passes on. */
export const OPEN_WEB_MAX_PATH = 2048;
const OPEN_WEB_FAILED = "HiveTTY couldn't open that page. Try again.";
/** A backslash or a control character: one a browser may fold into `//`. */
const unsafePathChar = (path: string): boolean =>
  [...path].some((char) => char === '\\' || char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);

export function generateDeviceKey(): DeviceKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicJwk: publicKey.export({ format: 'jwk' }), privateJwk: privateKey.export({ format: 'jwk' }) };
}

const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const signedInFrom = (account: StoredAccount): AccountState => ({
  kind: 'signed-in',
  email: account.email,
  name: account.name,
  deviceId: account.deviceId,
});

interface Pending {
  verifier: string;
  state: string;
  timer: NodeJS.Timeout;
  /** Where cancel, the deadline or a failed open return to. */
  restore: AccountState;
}

export function createAuthClient(deps: AuthClientDeps): AuthClient {
  const { cloud, store, scheme } = deps;
  const redirectUri = redirectUriFor(scheme);
  const listeners = new Set<(state: AccountState) => void>();
  let current: AccountState = { kind: 'signed-out' };
  let pending: Pending | null = null;
  let access: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<string | null> | null = null;
  let refreshTimer: NodeJS.Timeout | null = null;
  let backoffMs = BACKOFF_START_MS;
  /** Bumped by every sign-out and every exchange: a result from an older generation never lands. */
  let generation = 0;
  /**
   * The code exchange under way (0: none). No refresh may start with the old token meanwhile. Its own
   * token, not the generation: a revoked account (`forget`) must not strand a sign-in that replaces it.
   */
  let activeExchange = 0;
  let exchangeSeq = 0;
  /** A device-flow sign-in under way: the browser `pending`'s twin. */
  let codeFlow: { controller: AbortController; restore: AccountState } | null = null;

  const abortCodeFlow = (): void => {
    if (!codeFlow) return;
    const { controller } = codeFlow;
    codeFlow = null; // first: the aborted call must not restore over whatever replaces it
    controller.abort();
  };

  const set = (next: AccountState): void => {
    current = next;
    for (const listener of listeners) listener(next);
  };

  const clearPending = (): void => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  };

  const clearRefreshTimer = (): void => {
    if (!refreshTimer) return;
    clearTimeout(refreshTimer);
    refreshTimer = null;
  };

  const schedule = (ms: number): void => {
    clearRefreshTimer();
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, ms);
  };

  const signedOut = (why?: SignedOutReason, message?: string): AccountState => ({
    kind: 'signed-out',
    ...(why ? { reason: why } : {}),
    ...(message ? { message } : {}),
  });

  /** Forget the account: tokens, timers and the stored blob. Leaves any sign-in attempt alone. */
  const forget = (): void => {
    generation += 1;
    clearRefreshTimer();
    access = null;
    refreshing = null;
    backoffMs = BACKOFF_START_MS;
    store.clear();
  };

  /** The person signed out, or their new account could not be saved: everything stops. */
  const signOutLocally = (why?: SignedOutReason, message?: string): void => {
    forget();
    clearPending();
    abortCodeFlow();
    activeExchange = 0;
    set(signedOut(why, message));
  };

  /**
   * The cloud refused the stored account (revoked, rotated away, unsavable). A sign-in under way is the
   * way back, so it survives: it learns where cancel now returns to, and an exchange settles the state.
   */
  const dropAccount = (why?: SignedOutReason, message?: string): void => {
    forget();
    if (pending) pending.restore = signedOut(why, message);
    else if (codeFlow) codeFlow.restore = signedOut(why, message);
    else if (!activeExchange) set(signedOut(why, message));
  };

  /** Store first: an account that cannot be saved is not signed in. The caller announces it. */
  const accept = (response: TokenResponse, deviceKey: DeviceKey): StoredAccount | null => {
    const account: StoredAccount = {
      refreshToken: response.refreshToken,
      deviceId: response.deviceId,
      deviceKey,
      email: response.user.email,
      name: response.user.name,
    };
    if (!store.write(account)) return null;
    access = { token: response.accessToken, expiresAt: Date.now() + response.expiresIn * 1000 };
    backoffMs = BACKOFF_START_MS;
    schedule(Math.max(0, response.expiresIn * 1000 - REFRESH_LEAD_MS));
    return account;
  };

  /** A new sign-in that is open keeps the UI on signing-in; it returns to this account if cancelled. */
  const announce = (account: StoredAccount): void => {
    if (pending) pending.restore = signedInFrom(account);
    else if (codeFlow) codeFlow.restore = signedInFrom(account);
    else set(signedInFrom(account));
  };

  /** One refresh in flight, always: rotation makes a second one look like token reuse. */
  const refresh = (): Promise<string | null> => {
    if (refreshing) return refreshing;
    if (activeExchange) return Promise.resolve(null);
    const stored = store.read();
    if (!stored) return Promise.resolve(null);
    const gen = generation;
    const run = (async (): Promise<string | null> => {
      try {
        const response = await cloud.token({ grant_type: 'refresh_token', refresh_token: stored.refreshToken });
        if (gen !== generation) return null;
        const account = accept(response, stored.deviceKey);
        if (!account) {
          dropAccount('error', NO_ENCRYPTION);
          return null;
        }
        // Mid-exchange, the exchange announces the outcome; a flash of signed-in would be wrong.
        if (!activeExchange) announce(account);
        return response.accessToken;
      } catch (cause) {
        if (gen !== generation) return null;
        if (cause instanceof CloudError && cause.kind === 'invalid_grant') {
          dropAccount(cause.description === 'device_revoked' ? 'device-revoked' : undefined);
          return null;
        }
        schedule(backoffMs);
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        return null;
      } finally {
        if (gen === generation) refreshing = null;
      }
    })();
    refreshing = run;
    return run;
  };

  const getAccessToken = (): Promise<string | null> =>
    access && access.expiresAt - Date.now() > REFRESH_LEAD_MS ? Promise.resolve(access.token) : refresh();

  const authedFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const token = await getAccessToken();
    if (!token) throw new CloudError(current.kind === 'signed-in' ? 'network' : 'refused', 'no access token');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    const response = await cloud.request(path, { ...init, headers });
    if (response.status === 401) {
      const body: unknown = await response.clone().json().catch(() => null);
      if (stringField(body, 'error') === 'invalid_token' && stringField(body, 'error_description') === 'device_revoked') {
        dropAccount('device-revoked');
      } else {
        access = null; // the next call refreshes
      }
    }
    return response;
  };

  return {
    state: () => current,

    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start() {
      const stored = store.read();
      if (!stored) return;
      set(signedInFrom(stored));
      void refresh();
    },

    async signIn() {
      if (!deps.encryptionAvailable()) return { error: NO_ENCRYPTION };
      const restore: AccountState =
        pending?.restore ?? codeFlow?.restore ?? (current.kind === 'signed-in' ? current : { kind: 'signed-out' });
      clearPending();
      abortCodeFlow();
      const verifier = deps.randomBytes(32).toString('base64url');
      const state = deps.randomBytes(16).toString('base64url');
      const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
      const timer = setTimeout(() => {
        // pending.restore, not the captured one: a revoke or a refresh may have moved it since.
        const back = pending?.restore ?? restore;
        pending = null;
        set(back.kind === 'signed-in' ? back : { kind: 'signed-out', reason: 'timeout' });
      }, SIGN_IN_DEADLINE_MS);
      pending = { verifier, state, timer, restore };
      set({ kind: 'signing-in' });
      try {
        await deps.openExternal(cloud.authorizeUrl({ redirectUri, codeChallenge, state }));
      } catch (cause) {
        // A replaced, cancelled or answered attempt is no longer this call's to undo.
        if (pending?.state === state) {
          const back = pending.restore;
          clearPending();
          set(back);
        }
        return { error: `Could not open the browser: ${reason(cause)}` };
      }
      return { ok: true };
    },

    cancel() {
      if (codeFlow) {
        const { restore } = codeFlow;
        abortCodeFlow();
        set(restore);
        return;
      }
      if (!pending) return;
      const { restore } = pending;
      clearPending();
      set(restore);
    },

    async signInWithCode({ onCode, signal }) {
      if (!deps.encryptionAvailable()) return { error: NO_ENCRYPTION, failure: 'storage' };
      // Cancelled before it began: nothing to start, and nothing replaced.
      if (signal?.aborted) return { error: FLOW_MESSAGES.aborted, failure: 'aborted' };
      const restore: AccountState =
        pending?.restore ?? codeFlow?.restore ?? (current.kind === 'signed-in' ? current : { kind: 'signed-out' });
      clearPending();
      abortCodeFlow();
      const mine = { controller: new AbortController(), restore };
      codeFlow = mine;
      const onCallerAbort = (): void => mine.controller.abort();
      signal?.addEventListener('abort', onCallerAbort, { once: true });
      set({ kind: 'signing-in' });

      const stored = store.read();
      const deviceKey = stored?.deviceKey ?? deps.generateDeviceKey();
      const { kty, crv, x } = deviceKey.publicJwk;
      let response: TokenResponse;
      try {
        response = await deps.runDeviceFlow({
          device: {
            name: deps.hostname(),
            publicKey: JSON.stringify({ kty, crv, x }),
            ...(stored ? { id: stored.deviceId } : {}),
          },
          onCode,
          signal: mine.controller.signal,
        });
      } catch (cause) {
        const failure: DeviceFlowFailure = cause instanceof DeviceFlowError ? cause.kind : 'refused';
        if (codeFlow === mine) {
          codeFlow = null;
          set(mine.restore);
        }
        return { error: FLOW_MESSAGES[failure], failure };
      } finally {
        signal?.removeEventListener('abort', onCallerAbort);
      }
      if (codeFlow !== mine) return { error: FLOW_MESSAGES.aborted, failure: 'aborted' };
      codeFlow = null;
      // Cancelled as the token arrived: the person asked to stop, so nothing is stored.
      if (mine.controller.signal.aborted) {
        set(mine.restore);
        return { error: FLOW_MESSAGES.aborted, failure: 'aborted' };
      }

      // The same finish as handleCallback: let a refresh in flight land, then replace the account.
      exchangeSeq += 1;
      const attempt = exchangeSeq;
      activeExchange = attempt;
      if (refreshing) await refreshing;
      if (activeExchange !== attempt) return { error: FLOW_MESSAGES.aborted, failure: 'aborted' };
      activeExchange = 0;
      generation += 1;
      refreshing = null;
      clearRefreshTimer();
      const account = accept(response, deviceKey);
      if (!account) {
        signOutLocally('error', NO_ENCRYPTION);
        return { error: NO_ENCRYPTION, failure: 'storage' };
      }
      announce(account);
      return { ok: true };
    },

    async handleCallback(url) {
      const callback = parseCallback(url, scheme);
      if (!callback || !pending || callback.state !== pending.state) return;
      const { verifier } = pending;
      clearPending(); // consumed: a second delivery of the same link is ignored
      exchangeSeq += 1;
      const attempt = exchangeSeq;
      activeExchange = attempt;
      // A refresh already in flight has rotated the token at the cloud: let it land, or it is lost.
      if (refreshing) await refreshing;
      if (activeExchange !== attempt) return; // signed out, or a newer exchange took over, meanwhile
      generation += 1; // any refresh still settling belongs to the account this exchange replaces
      refreshing = null;
      clearRefreshTimer();
      const stored = store.read();
      const deviceKey = stored?.deviceKey ?? deps.generateDeviceKey();
      const { kty, crv, x } = deviceKey.publicJwk;
      const form: Record<string, string> = {
        grant_type: 'authorization_code',
        code: callback.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        device_name: deps.hostname(),
        device_public_key: JSON.stringify({ kty, crv, x }),
      };
      if (stored) form.device_id = stored.deviceId;
      try {
        const response = await cloud.token(form);
        if (activeExchange !== attempt) return;
        activeExchange = 0;
        const account = accept(response, deviceKey);
        if (account) announce(account);
        else signOutLocally('error', NO_ENCRYPTION); // never leave the old account usable behind it
      } catch (cause) {
        if (activeExchange !== attempt) return;
        activeExchange = 0;
        const kept = store.read();
        if (kept) {
          announce(kept);
          schedule(0); // the exchange stopped the old refresh timer; resume it
        } else if (pending) {
          pending.restore = signedOut('error', reason(cause));
        } else {
          set(signedOut('error', reason(cause)));
        }
      }
    },

    async signOut() {
      const stored = store.read();
      signOutLocally();
      if (stored) await cloud.revoke(stored.refreshToken).catch(() => undefined);
    },

    getAccessToken,

    authedFetch,

    async openWeb(path) {
      // The path crosses IPC: a same-site path only, the shape the cloud's safeNextPath accepts.
      if (
        typeof path !== 'string' ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        path.length > OPEN_WEB_MAX_PATH ||
        unsafePathChar(path)
      ) {
        return { error: 'That is not a page of the HiveTTY site.' };
      }
      if (current.kind !== 'signed-in') return { error: 'Sign in to HiveTTY first.' };
      let response: Response;
      try {
        response = await authedFetch('/api/oauth/web-session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ next: path }),
        });
      } catch {
        return { error: "Couldn't reach HiveTTY. Try again." };
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        // authedFetch has already signed a revoked device out; a raw token code is no sentence for a person.
        return { error: current.kind === 'signed-in' ? OPEN_WEB_FAILED : 'Sign in to HiveTTY first.' };
      }
      if (!response.ok) return { error: stringField(body, 'error_description') ?? OPEN_WEB_FAILED };
      // The URL comes off the network: http(s) only, and only on the cloud's own origin.
      const url = stringField(body, 'url');
      if (!url || !isSafeExternalUrl(url) || new URL(url).origin !== new URL(cloud.baseUrl).origin) {
        return { error: OPEN_WEB_FAILED };
      }
      try {
        await deps.openExternal(url);
      } catch {
        return { error: "The browser didn't open." };
      }
      return { ok: true };
    },
  };
}
