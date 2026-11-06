import { createHash, generateKeyPairSync } from 'node:crypto';

import type { AccountState, SignedOutReason, SignInResult } from '@shared/account-contract';

import { type AccountStore, type DeviceKey, NO_ENCRYPTION, type StoredAccount } from './account-store';
import { type Cloud, CloudError, stringField, type TokenResponse } from './cloud';
import { parseCallback, redirectUriFor, type Scheme } from './deep-link';

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
}

export interface AuthClient {
  state(): AccountState;
  onChange(listener: (state: AccountState) => void): () => void;
  /** At launch: a stored account is signed in at once, then refreshed. */
  start(): void;
  signIn(): Promise<SignInResult>;
  cancel(): void;
  handleCallback(url: string): Promise<void>;
  signOut(): Promise<void>;
  /** A token with more than a minute left, refreshing if needed; `null` when signed out or offline. */
  getAccessToken(): Promise<string | null>;
  /** A cloud call with the bearer token; a `device_revoked` 401 signs this device out. */
  authedFetch(path: string, init?: RequestInit): Promise<Response>;
}

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

  const signOutLocally = (why?: SignedOutReason, message?: string): void => {
    generation += 1;
    clearPending();
    clearRefreshTimer();
    access = null;
    refreshing = null;
    backoffMs = BACKOFF_START_MS;
    store.clear();
    set({ kind: 'signed-out', ...(why ? { reason: why } : {}), ...(message ? { message } : {}) });
  };

  /** Store first: an account that cannot be saved is not signed in. */
  const accept = (response: TokenResponse, deviceKey: DeviceKey): boolean => {
    const account: StoredAccount = {
      refreshToken: response.refreshToken,
      deviceId: response.deviceId,
      deviceKey,
      email: response.user.email,
      name: response.user.name,
    };
    if (!store.write(account)) return false;
    access = { token: response.accessToken, expiresAt: Date.now() + response.expiresIn * 1000 };
    backoffMs = BACKOFF_START_MS;
    schedule(Math.max(0, response.expiresIn * 1000 - REFRESH_LEAD_MS));
    // A refresh that lands while a new sign-in is open must not knock the UI out of signing-in.
    if (pending) pending.restore = signedInFrom(account);
    else set(signedInFrom(account));
    return true;
  };

  /** One refresh in flight, always: rotation makes a second one look like token reuse. */
  const refresh = (): Promise<string | null> => {
    if (refreshing) return refreshing;
    const stored = store.read();
    if (!stored) return Promise.resolve(null);
    const gen = generation;
    const run = (async (): Promise<string | null> => {
      try {
        const response = await cloud.token({ grant_type: 'refresh_token', refresh_token: stored.refreshToken });
        if (gen !== generation) return null;
        if (!accept(response, stored.deviceKey)) {
          signOutLocally('error', NO_ENCRYPTION);
          return null;
        }
        return response.accessToken;
      } catch (cause) {
        if (gen !== generation) return null;
        if (cause instanceof CloudError && cause.kind === 'invalid_grant') {
          signOutLocally(cause.description === 'device_revoked' ? 'device-revoked' : undefined);
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
        pending?.restore ?? (current.kind === 'signed-in' ? current : { kind: 'signed-out' });
      clearPending();
      const verifier = deps.randomBytes(32).toString('base64url');
      const state = deps.randomBytes(16).toString('base64url');
      const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
      const timer = setTimeout(() => {
        pending = null;
        set(restore.kind === 'signed-in' ? restore : { kind: 'signed-out', reason: 'timeout' });
      }, SIGN_IN_DEADLINE_MS);
      pending = { verifier, state, timer, restore };
      set({ kind: 'signing-in' });
      try {
        await deps.openExternal(cloud.authorizeUrl({ redirectUri, codeChallenge, state }));
      } catch (cause) {
        clearPending();
        set(restore);
        return { error: `Could not open the browser: ${reason(cause)}` };
      }
      return { ok: true };
    },

    cancel() {
      if (!pending) return;
      const { restore } = pending;
      clearPending();
      set(restore);
    },

    async handleCallback(url) {
      const callback = parseCallback(url, scheme);
      if (!callback || !pending || callback.state !== pending.state) return;
      const { verifier, restore } = pending;
      clearPending(); // consumed: a second delivery of the same link is ignored
      generation += 1;
      const gen = generation;
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
        if (gen !== generation) return;
        if (!accept(response, deviceKey)) set({ kind: 'signed-out', reason: 'error', message: NO_ENCRYPTION });
      } catch (cause) {
        if (gen !== generation) return;
        if (restore.kind === 'signed-in') {
          set(restore);
          schedule(0); // the exchange stopped the old refresh timer; resume it
        } else {
          set({ kind: 'signed-out', reason: 'error', message: reason(cause) });
        }
      }
    },

    async signOut() {
      const stored = store.read();
      signOutLocally();
      if (stored) await cloud.revoke(stored.refreshToken).catch(() => undefined);
    },

    getAccessToken,

    async authedFetch(path, init = {}) {
      const token = await getAccessToken();
      if (!token) throw new CloudError(current.kind === 'signed-in' ? 'network' : 'refused', 'no access token');
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      const response = await cloud.request(path, { ...init, headers });
      if (response.status === 401) {
        const body: unknown = await response.clone().json().catch(() => null);
        if (stringField(body, 'error') === 'invalid_token' && stringField(body, 'error_description') === 'device_revoked') {
          signOutLocally('device-revoked');
        } else {
          access = null; // the next call refreshes
        }
      }
      return response;
    },
  };
}
