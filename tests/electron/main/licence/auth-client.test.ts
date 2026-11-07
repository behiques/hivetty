// @vitest-environment node
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountState } from '../../../../electron/shared/account-contract';
import type { AccountStore, StoredAccount } from '../../../../electron/main/licence/account-store';
import {
  BACKOFF_MAX_MS,
  BACKOFF_START_MS,
  createAuthClient,
  generateDeviceKey,
  SIGN_IN_DEADLINE_MS,
} from '../../../../electron/main/licence/auth-client';
import { type Cloud, CloudError, type TokenResponse } from '../../../../electron/main/licence/cloud';
import { DeviceFlowError, type DeviceFlowInput } from '../../../../electron/main/licence/device-flow';

const KEY = {
  publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'pub' },
  privateJwk: { kty: 'OKP', crv: 'Ed25519', x: 'pub', d: 'priv' },
};

const STORED: StoredAccount = {
  refreshToken: 'rt-0',
  deviceId: 'dev-0',
  deviceKey: KEY,
  email: 'ada@example.com',
  name: 'Ada',
};

const tokens = (n: number, over: Partial<TokenResponse> = {}): TokenResponse => ({
  accessToken: `at-${String(n)}`,
  expiresIn: 900,
  refreshToken: `rt-${String(n)}`,
  deviceId: 'dev-0',
  user: { email: 'ada@example.com', name: 'Ada' },
  ...over,
});

function memoryStore(initial: StoredAccount | null = null, writable = true) {
  let value = initial;
  const store: AccountStore & { value: () => StoredAccount | null } = {
    read: vi.fn(() => value),
    write: vi.fn((account: StoredAccount) => {
      if (!writable) return false;
      value = account;
      return true;
    }),
    clear: vi.fn(() => {
      value = null;
    }),
    exists: vi.fn(() => value !== null),
    value: () => value,
  };
  return store;
}

function fakeCloud() {
  return {
    baseUrl: 'https://c.test',
    authorizeUrl: ({ redirectUri, codeChallenge, state }: Parameters<Cloud['authorizeUrl']>[0]) =>
      `https://c.test/api/oauth/authorize?redirect_uri=${redirectUri}&code_challenge=${codeChallenge}&state=${state}`,
    token: vi.fn<Cloud['token']>(),
    revoke: vi.fn<Cloud['revoke']>().mockResolvedValue(undefined),
    request: vi.fn<Cloud['request']>(),
  } satisfies Cloud;
}

function harness(opts: { stored?: StoredAccount | null; encryption?: boolean; writable?: boolean } = {}) {
  const cloud = fakeCloud();
  const store = memoryStore(opts.stored ?? null, opts.writable ?? true);
  const openExternal = vi.fn().mockResolvedValue(undefined);
  let byte = 0;
  let flow: { resolve: (t: TokenResponse) => void; reject: (e: unknown) => void; input: DeviceFlowInput } | null = null;
  const runDeviceFlow = vi.fn(
    (input: DeviceFlowInput) =>
      new Promise<TokenResponse>((resolve, reject) => {
        flow = { resolve, reject, input };
        input.signal.addEventListener('abort', () => reject(new DeviceFlowError('aborted')), { once: true });
      }),
  );
  const client = createAuthClient({
    cloud,
    store,
    encryptionAvailable: () => opts.encryption ?? true,
    openExternal,
    hostname: () => 'ada-mbp',
    randomBytes: (size) => Buffer.alloc(size, ++byte),
    generateDeviceKey: () => KEY,
    scheme: 'hivetty',
    runDeviceFlow,
  });
  const states: AccountState[] = [];
  client.onChange((state) => states.push(state));
  /** The state the last authorize URL carried. */
  const lastState = () => new URL(openExternal.mock.lastCall![0] as string).searchParams.get('state')!;
  const callback = (state = lastState(), code = 'code-1') =>
    client.handleCallback(`hivetty://auth/callback?code=${code}&state=${state}`);
  return { client, cloud, store, openExternal, states, lastState, callback, runDeviceFlow, flow: () => flow! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('sign-in', () => {
  it('starts signed out and opens /authorize with an S256 challenge of a 32-byte verifier', async () => {
    const { client, openExternal, states } = harness();
    expect(client.state()).toEqual({ kind: 'signed-out' });

    await expect(client.signIn()).resolves.toEqual({ ok: true });

    const url = new URL(openExternal.mock.calls[0]![0] as string);
    expect(url.searchParams.get('redirect_uri')).toBe('hivetty://auth/callback');
    const verifier = Buffer.alloc(32, 1).toString('base64url');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(url.searchParams.get('state')).toBe(Buffer.alloc(16, 2).toString('base64url'));
    expect(states).toEqual([{ kind: 'signing-in' }]);
  });

  it('refuses up front without encryption: no browser, nothing written', async () => {
    const { client, openExternal, store } = harness({ encryption: false });
    const result = await client.signIn();
    expect(result).toEqual({ error: expect.stringContaining('keychain') });
    expect(openExternal).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(client.state()).toEqual({ kind: 'signed-out' });
  });

  it('reports a browser that will not open and returns to the previous state', async () => {
    const { client, openExternal } = harness();
    openExternal.mockRejectedValueOnce(new Error('no browser'));
    await expect(client.signIn()).resolves.toEqual({ error: 'Could not open the browser: no browser' });
    expect(client.state()).toEqual({ kind: 'signed-out' });
  });

  it('cancel drops the attempt: a later callback with its state makes no request', async () => {
    const { client, cloud, lastState, callback } = harness();
    await client.signIn();
    const state = lastState();
    client.cancel();
    expect(client.state()).toEqual({ kind: 'signed-out' });
    await callback(state);
    expect(cloud.token).not.toHaveBeenCalled();
  });

  it('cancel with nothing pending changes nothing', () => {
    const { client, states } = harness();
    client.cancel();
    expect(states).toEqual([]);
  });

  it('times out after ten minutes to signed-out (timeout), and a late callback is ignored', async () => {
    const { client, cloud, lastState, callback } = harness();
    await client.signIn();
    const state = lastState();
    vi.advanceTimersByTime(SIGN_IN_DEADLINE_MS);
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'timeout' });
    await callback(state);
    expect(cloud.token).not.toHaveBeenCalled();
  });

  it('a second sign-in replaces the first: the first state no longer matches', async () => {
    const { client, cloud, lastState, callback } = harness();
    await client.signIn();
    const first = lastState();
    await client.signIn();
    await callback(first);
    expect(cloud.token).not.toHaveBeenCalled();
  });

  it('onChange returns a disposer', async () => {
    const { client } = harness();
    const listener = vi.fn();
    const dispose = client.onChange(listener);
    dispose();
    await client.signIn();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('generateDeviceKey', () => {
  it('makes an Ed25519 pair whose public half carries no private member', () => {
    const key = generateDeviceKey();
    expect(key.publicJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(key.publicJwk).not.toHaveProperty('d');
    expect(key.privateJwk).toHaveProperty('d');
  });
});

describe('the callback', () => {
  it('exchanges the code with verifier, redirect, device name and a public-only key, then stores the account', async () => {
    const { client, cloud, store, callback, states } = harness();
    cloud.token.mockResolvedValueOnce(tokens(1));
    await client.signIn();
    await callback();

    const form = cloud.token.mock.calls[0]![0] as Record<string, string>;
    expect(form).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      code_verifier: Buffer.alloc(32, 1).toString('base64url'),
      redirect_uri: 'hivetty://auth/callback',
      device_name: 'ada-mbp',
      device_public_key: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'pub' }),
    });
    expect(JSON.parse(form.device_public_key!)).not.toHaveProperty('d');
    expect(store.value()).toEqual({
      refreshToken: 'rt-1',
      deviceId: 'dev-0',
      deviceKey: KEY,
      email: 'ada@example.com',
      name: 'Ada',
    });
    expect(states.at(-1)).toEqual({ kind: 'signed-in', email: 'ada@example.com', name: 'Ada', deviceId: 'dev-0' });
    await expect(client.getAccessToken()).resolves.toBe('at-1');
  });

  it('sends the stored device id and reuses the stored key on a re-sign-in', async () => {
    const { client, cloud, callback } = harness({ stored: STORED });
    cloud.token.mockResolvedValue(tokens(1));
    await client.signIn();
    await callback();
    const form = cloud.token.mock.calls[0]![0] as Record<string, string>;
    expect(form.device_id).toBe('dev-0');
    expect(JSON.parse(form.device_public_key!)).toEqual({ kty: 'OKP', crv: 'Ed25519', x: 'pub' });
  });

  it.each([
    ['a wrong state', (state: string) => `hivetty://auth/callback?code=c&state=${state}x`],
    ['a non-callback URL', (state: string) => `hivetty://auth/other?code=c&state=${state}`],
    ['the dev scheme', (state: string) => `hivetty-dev://auth/callback?code=c&state=${state}`],
  ])('ignores %s and makes no request', async (_name, build) => {
    const { client, cloud, lastState } = harness();
    await client.signIn();
    await client.handleCallback(build(lastState()));
    expect(cloud.token).not.toHaveBeenCalled();
    expect(client.state()).toEqual({ kind: 'signing-in' });
  });

  it('ignores a callback with nothing pending', async () => {
    const { client, cloud } = harness();
    await client.handleCallback('hivetty://auth/callback?code=c&state=s');
    expect(cloud.token).not.toHaveBeenCalled();
  });

  it('ignores a second delivery of the same link (/signed-in repeats it)', async () => {
    const { client, cloud, callback, lastState } = harness();
    cloud.token.mockResolvedValue(tokens(1));
    await client.signIn();
    const state = lastState();
    await callback(state);
    await callback(state);
    expect(cloud.token).toHaveBeenCalledTimes(1);
  });

  it('ends signed-out with the keychain message when the store refuses the write', async () => {
    const { client, cloud, callback, store } = harness({ writable: false });
    cloud.token.mockResolvedValue(tokens(1));
    await client.signIn();
    await callback();
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'error', message: expect.stringContaining('keychain') });
    expect(store.value()).toBeNull();
  });

  it('ends signed-out with the cloud reason when the exchange fails', async () => {
    const { client, cloud, callback } = harness();
    cloud.token.mockRejectedValue(new CloudError('invalid_grant', 'invalid_grant'));
    await client.signIn();
    await callback();
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'error', message: 'invalid_grant: invalid_grant' });
  });

  it('a failed re-sign-in returns to the signed-in account and resumes refreshing', async () => {
    const { client, cloud, callback } = harness({ stored: STORED });
    cloud.token.mockResolvedValueOnce(tokens(1)); // start()'s refresh
    client.start();
    await vi.advanceTimersByTimeAsync(0); // settle start()'s refresh only, not the 840 s timer it schedules
    cloud.token.mockReset();
    cloud.token.mockRejectedValueOnce(new CloudError('network', 'offline')).mockResolvedValue(tokens(2));
    await client.signIn();
    await callback();
    expect(client.state()).toMatchObject({ kind: 'signed-in' });
    await vi.advanceTimersByTimeAsync(0);
    expect(cloud.token).toHaveBeenLastCalledWith({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
  });

  it('drops an exchange that resolves after a sign-out', async () => {
    const { client, cloud, callback, store } = harness();
    let resolve!: (value: TokenResponse) => void;
    cloud.token.mockReturnValue(new Promise<TokenResponse>((r) => (resolve = r)));
    await client.signIn();
    const exchanging = callback();
    await client.signOut();
    resolve(tokens(1));
    await exchanging;
    expect(store.value()).toBeNull();
    expect(client.state()).toEqual({ kind: 'signed-out' });
  });
});

describe('races around the exchange (task 6 review)', () => {
  it('a refresh asked for during the exchange makes no request with the old token', async () => {
    const { client, cloud, callback, store } = harness({ stored: STORED });
    let resolve!: (value: TokenResponse) => void;
    cloud.token.mockReturnValueOnce(new Promise<TokenResponse>((r) => (resolve = r)));
    await client.signIn();
    const exchanging = callback();
    await expect(client.getAccessToken()).resolves.toBeNull();
    expect(cloud.token).toHaveBeenCalledTimes(1);
    resolve(tokens(1));
    await exchanging;
    expect(store.value()?.refreshToken).toBe('rt-1');
    await expect(client.getAccessToken()).resolves.toBe('at-1');
  });

  it('waits for a refresh already in flight, so the rotated token is not lost, then exchanges', async () => {
    const { client, cloud, callback, store } = harness({ stored: STORED });
    let resolveRefresh!: (value: TokenResponse) => void;
    cloud.token
      .mockReturnValueOnce(new Promise<TokenResponse>((r) => (resolveRefresh = r)))
      .mockRejectedValueOnce(new CloudError('network', 'offline'))
      .mockResolvedValue(tokens(3));
    const refreshing = client.getAccessToken();
    await client.signIn();
    const exchanging = callback();
    resolveRefresh(tokens(1));
    await refreshing;
    await exchanging;
    expect(store.value()?.refreshToken).toBe('rt-1');
    expect(client.state()).toMatchObject({ kind: 'signed-in' });
    await vi.advanceTimersByTimeAsync(0);
    expect(cloud.token).toHaveBeenLastCalledWith({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
  });

  it('a re-sign-in whose account cannot be saved signs out fully: no old token, no old account', async () => {
    const { client, cloud, callback, store } = harness({ stored: STORED });
    cloud.token.mockResolvedValueOnce(tokens(1));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    (store.write as ReturnType<typeof vi.fn>).mockReturnValue(false);
    cloud.token.mockResolvedValue(tokens(2));
    await client.signIn();
    await callback();
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'error', message: expect.stringContaining('keychain') });
    expect(store.value()).toBeNull();
    await expect(client.getAccessToken()).resolves.toBeNull();
  });

  it('a device revoked by refresh during a sign-in keeps the sign-in open', async () => {
    const { client, cloud, callback, store } = harness({ stored: STORED });
    cloud.token.mockRejectedValueOnce(new CloudError('invalid_grant', 'device_revoked')).mockResolvedValue(tokens(1));
    await client.signIn();
    await client.getAccessToken();
    expect(store.value()).toBeNull();
    expect(client.state()).toEqual({ kind: 'signing-in' });
    await callback();
    expect(client.state()).toMatchObject({ kind: 'signed-in' });
    expect(cloud.token.mock.calls[1]![0]).not.toHaveProperty('device_id');
  });

  it('cancel after a revoke during sign-in returns to the revoked state', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockRejectedValueOnce(new CloudError('invalid_grant', 'device_revoked'));
    await client.signIn();
    await client.getAccessToken();
    client.cancel();
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'device-revoked' });
  });
});

describe('refresh', () => {
  it('start() with a stored account is signed in at once and refreshes, rotating the stored token', async () => {
    const { client, cloud, store, states } = harness({ stored: STORED });
    cloud.token.mockResolvedValue(tokens(1));
    client.start();
    expect(states[0]).toEqual({ kind: 'signed-in', email: 'ada@example.com', name: 'Ada', deviceId: 'dev-0' });
    await vi.advanceTimersByTimeAsync(0);
    expect(cloud.token).toHaveBeenCalledWith({ grant_type: 'refresh_token', refresh_token: 'rt-0' });
    expect(store.value()?.refreshToken).toBe('rt-1');
    expect(store.value()?.deviceKey).toEqual(KEY);
  });

  it('start() with nothing stored stays signed out and makes no request', () => {
    const { client, cloud, states } = harness();
    client.start();
    expect(states).toEqual([]);
    expect(cloud.token).not.toHaveBeenCalled();
  });

  it('refreshes 60 s before expiry', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockResolvedValueOnce(tokens(1)).mockResolvedValueOnce(tokens(2));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(840_000 - 1);
    expect(cloud.token).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.token).toHaveBeenCalledTimes(2);
    expect(cloud.token).toHaveBeenLastCalledWith({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
  });

  it('two triggers at once make one request', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockResolvedValue(tokens(1));
    const [a, b] = await Promise.all([client.getAccessToken(), client.getAccessToken()]);
    expect(a).toBe('at-1');
    expect(b).toBe('at-1');
    expect(cloud.token).toHaveBeenCalledTimes(1);
  });

  it('answers the cached token without a request while it has more than a minute left', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockResolvedValue(tokens(1));
    await client.getAccessToken();
    await client.getAccessToken();
    expect(cloud.token).toHaveBeenCalledTimes(1);
  });

  it('invalid_grant clears the store and emits a plain signed-out', async () => {
    const { client, cloud, store } = harness({ stored: STORED });
    cloud.token.mockRejectedValue(new CloudError('invalid_grant', 'invalid_grant'));
    await expect(client.getAccessToken()).resolves.toBeNull();
    expect(store.value()).toBeNull();
    expect(client.state()).toEqual({ kind: 'signed-out' });
  });

  it('invalid_grant with device_revoked carries the reason', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockRejectedValue(new CloudError('invalid_grant', 'device_revoked'));
    await client.getAccessToken();
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'device-revoked' });
  });

  it('a network error keeps the store and the signed-in state, and backs off 5 s doubling to 5 min', async () => {
    const { client, cloud, store } = harness({ stored: STORED });
    cloud.token.mockRejectedValue(new CloudError('network', 'offline'));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.value()).toEqual(STORED);
    expect(client.state()).toMatchObject({ kind: 'signed-in' });

    // No getAccessToken() here: an on-demand refresh would reschedule and shift the sequence.
    const delays = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000];
    expect(delays[0]).toBe(BACKOFF_START_MS);
    expect(delays.at(-1)).toBe(BACKOFF_MAX_MS);
    for (const delay of delays) {
      const before = cloud.token.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(cloud.token.mock.calls.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(cloud.token.mock.calls.length).toBe(before + 1);
    }
  });

  it('a refused answer backs off like a network error', async () => {
    const { client, cloud, store } = harness({ stored: STORED });
    cloud.token.mockRejectedValueOnce(new CloudError('refused', 'HTTP 502')).mockResolvedValue(tokens(1));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.value()).toEqual(STORED);
    await vi.advanceTimersByTimeAsync(BACKOFF_START_MS);
    expect(store.value()?.refreshToken).toBe('rt-1');
  });

  it('a rotated token the store cannot save signs out with the keychain message', async () => {
    const { client, cloud } = harness({ stored: STORED, writable: false });
    cloud.token.mockResolvedValue(tokens(1));
    await client.getAccessToken();
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'error', message: expect.stringContaining('keychain') });
  });

  it('a refresh landing during a new sign-in keeps the UI on signing-in', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockResolvedValue(tokens(1));
    await client.signIn();
    await client.getAccessToken();
    expect(client.state()).toEqual({ kind: 'signing-in' });
    client.cancel();
    expect(client.state()).toMatchObject({ kind: 'signed-in' });
  });

  it('getAccessToken answers null with nothing stored', async () => {
    const { client, cloud } = harness();
    await expect(client.getAccessToken()).resolves.toBeNull();
    expect(cloud.token).not.toHaveBeenCalled();
  });
});

describe('sign-out', () => {
  it('revokes the refresh token and clears the store', async () => {
    const { client, cloud, store } = harness({ stored: STORED });
    client.start();
    await client.signOut();
    expect(cloud.revoke).toHaveBeenCalledWith('rt-0');
    expect(store.value()).toBeNull();
    expect(client.state()).toEqual({ kind: 'signed-out' });
  });

  it('clears the store even when offline', async () => {
    const { client, cloud, store } = harness({ stored: STORED });
    cloud.revoke.mockRejectedValue(new CloudError('network', 'offline'));
    await expect(client.signOut()).resolves.toBeUndefined();
    expect(store.value()).toBeNull();
  });

  it('makes no revoke call with nothing stored', async () => {
    const { client, cloud } = harness();
    await client.signOut();
    expect(cloud.revoke).not.toHaveBeenCalled();
  });

  it('drops a refresh that resolves after the sign-out', async () => {
    const { client, cloud, store } = harness({ stored: STORED });
    let resolve!: (value: TokenResponse) => void;
    cloud.token.mockReturnValue(new Promise<TokenResponse>((r) => (resolve = r)));
    const refreshing = client.getAccessToken();
    await client.signOut();
    resolve(tokens(1));
    await expect(refreshing).resolves.toBeNull();
    expect(store.value()).toBeNull();
  });

  it('stops the scheduled refresh', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockResolvedValue(tokens(1));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    await client.signOut();
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 4);
    expect(cloud.token).toHaveBeenCalledTimes(1);
  });
});

describe('authedFetch', () => {
  const unauthorized = (description?: string) =>
    new Response(JSON.stringify({ error: 'invalid_token', ...(description ? { error_description: description } : {}) }), {
      status: 401,
    });

  it('adds the bearer token and returns the response', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockResolvedValue(tokens(1));
    cloud.request.mockResolvedValue(new Response('ok'));
    const response = await client.authedFetch('/api/lease', { method: 'POST' });
    expect(await response.text()).toBe('ok');
    const [path, init] = cloud.request.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/lease');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer at-1');
  });

  it('a device_revoked 401 signs the device out with that reason', async () => {
    const { client, cloud, store } = harness({ stored: STORED });
    cloud.token.mockResolvedValue(tokens(1));
    cloud.request.mockResolvedValue(unauthorized('device_revoked'));
    const response = await client.authedFetch('/api/lease');
    expect(response.status).toBe(401);
    expect(store.value()).toBeNull();
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'device-revoked' });
  });

  it('any other 401 drops the access token so the next call refreshes', async () => {
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockResolvedValueOnce(tokens(1)).mockResolvedValueOnce(tokens(2));
    cloud.request.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(new Response('ok'));
    await client.authedFetch('/api/lease');
    expect(client.state()).toMatchObject({ kind: 'signed-in' });
    await client.authedFetch('/api/lease');
    expect(cloud.token).toHaveBeenCalledTimes(2);
  });

  it('throws refused when signed out and network when signed in but offline', async () => {
    await expect(harness().client.authedFetch('/x')).rejects.toMatchObject({ kind: 'refused' });
    const { client, cloud } = harness({ stored: STORED });
    cloud.token.mockRejectedValue(new CloudError('network', 'offline'));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    await expect(client.authedFetch('/x')).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('races around the exchange (tasks 7-9 review)', () => {
  it('a device_revoked 401 during the exchange does not strand it', async () => {
    const { client, cloud, callback } = harness({ stored: STORED });
    cloud.token.mockResolvedValueOnce(tokens(1));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    let resolve!: (value: TokenResponse) => void;
    cloud.token.mockReturnValueOnce(new Promise<TokenResponse>((r) => (resolve = r)));
    cloud.request.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_token', error_description: 'device_revoked' }), { status: 401 }),
    );
    await client.signIn();
    const exchanging = callback();
    await client.authedFetch('/api/lease');
    resolve(tokens(2));
    await exchanging;
    expect(client.state()).toMatchObject({ kind: 'signed-in' });
    await expect(client.getAccessToken()).resolves.toBe('at-2');
  });

  it('the deadline after a revoke during sign-in ends signed out, not on the dropped account', async () => {
    const { client, cloud, store } = harness({ stored: STORED });
    cloud.token.mockResolvedValueOnce(tokens(1));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    cloud.token.mockRejectedValueOnce(new CloudError('invalid_grant', 'device_revoked'));
    await client.signIn();
    vi.setSystemTime(Date.now() + 900_000); // the access token has expired
    await client.getAccessToken();
    vi.advanceTimersByTime(SIGN_IN_DEADLINE_MS);
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'timeout' });
    expect(store.value()).toBeNull();
  });

  it('a late browser failure from a replaced attempt leaves the newer attempt alone', async () => {
    const { client, openExternal } = harness();
    let reject!: (cause: Error) => void;
    openExternal.mockReturnValueOnce(new Promise<void>((_, r) => (reject = r)));
    const first = client.signIn();
    await client.signIn();
    reject(new Error('no browser'));
    await first;
    expect(client.state()).toEqual({ kind: 'signing-in' });
  });
});

describe('openWeb (HIVE-268)', () => {
  const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  /** Signed in from the stored account, with `tokens(1)` behind the bearer. */
  async function signedInHarness() {
    const h = harness({ stored: STORED });
    h.cloud.token.mockResolvedValue(tokens(1));
    h.client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.client.state()).toMatchObject({ kind: 'signed-in' });
    return h;
  }

  it.each([[42], [''], ['account/plan'], ['//evil.test/x'], ['/\\evil.test'], ['/\t/evil.test'], ['/\n/evil.test'], ['/' + 'a'.repeat(2048)]])(
    'refuses %j and opens nothing',
    async (path) => {
      const { client, cloud, openExternal } = await signedInHarness();
      await expect(client.openWeb(path)).resolves.toEqual({ error: expect.any(String) });
      expect(cloud.request).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it('accepts a path of exactly 2048 characters', async () => {
    const { client, cloud } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(answer({ url: 'https://c.test/redeem?code=abc' }));
    await expect(client.openWeb('/' + 'a'.repeat(2047))).resolves.toEqual({ ok: true });
  });

  it('asks the cloud for a one-time link to the path and opens it', async () => {
    const { client, cloud, openExternal } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(answer({ url: 'https://c.test/api/oauth/web-session/redeem?code=abc' }));
    await expect(client.openWeb('/account/plan')).resolves.toEqual({ ok: true });
    const [path, init] = cloud.request.mock.calls.at(-1) as [string, RequestInit];
    expect(path).toBe('/api/oauth/web-session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ next: '/account/plan' });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer at-1');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(openExternal).toHaveBeenCalledWith('https://c.test/api/oauth/web-session/redeem?code=abc');
  });

  it.each([
    'https://evil.test/redeem?code=abc',
    'http://c.test/redeem?code=abc',
    'https://c.test.evil.test/redeem',
    'file:///etc/passwd',
    'not a url',
    42,
  ])('never opens %s', async (url) => {
    const { client, cloud, openExternal } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(answer({ url }));
    await expect(client.openWeb('/account')).resolves.toEqual({ error: "HiveTTY couldn't open that page. Try again." });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('says to sign in when signed out', async () => {
    const { client, cloud, openExternal } = harness();
    await expect(client.openWeb('/account')).resolves.toEqual({ error: 'Sign in to HiveTTY first.' });
    expect(cloud.request).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("says it couldn't reach HiveTTY on a network failure", async () => {
    const { client, cloud, openExternal } = await signedInHarness();
    cloud.request.mockRejectedValueOnce(new CloudError('network', 'offline'));
    await expect(client.openWeb('/account')).resolves.toEqual({ error: "Couldn't reach HiveTTY. Try again." });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("passes on the cloud's refusal", async () => {
    const { client, cloud, openExternal } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(
      answer({ error: 'invalid_request', error_description: 'next must be a path on this site' }, 400),
    );
    await expect(client.openWeb('/account')).resolves.toEqual({ error: 'next must be a path on this site' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('a refusal with no description gets a sentence of its own', async () => {
    const { client, cloud } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(new Response('<html>', { status: 500 }));
    await expect(client.openWeb('/account')).resolves.toEqual({ error: "HiveTTY couldn't open that page. Try again." });
  });

  it('a revoked device is signed out, told to sign in, and opens nothing', async () => {
    const { client, cloud, openExternal } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(answer({ error: 'invalid_token', error_description: 'device_revoked' }, 401));
    await expect(client.openWeb('/account')).resolves.toEqual({ error: 'Sign in to HiveTTY first.' });
    expect(client.state()).toEqual({ kind: 'signed-out', reason: 'device-revoked' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('any other 401 is a generic sentence, never the raw code', async () => {
    const { client, cloud, openExternal } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(answer({ error: 'invalid_token', error_description: 'expired' }, 401));
    await expect(client.openWeb('/account')).resolves.toEqual({ error: "HiveTTY couldn't open that page. Try again." });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('works when called unbound, as an IPC table may hold it', async () => {
    const { client, cloud } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(answer({ url: 'https://c.test/redeem?code=abc' }));
    const { openWeb } = client;
    await expect(openWeb('/account')).resolves.toEqual({ ok: true });
  });

  it("says the browser didn't open when opening fails", async () => {
    const { client, cloud, openExternal } = await signedInHarness();
    cloud.request.mockResolvedValueOnce(answer({ url: 'https://c.test/redeem?code=abc' }));
    openExternal.mockRejectedValueOnce(new Error('x'));
    await expect(client.openWeb('/account')).resolves.toEqual({ error: "The browser didn't open." });
  });
});

describe('signInWithCode', () => {
  it('runs the flow with this device, stores the account and announces it', async () => {
    const h = harness();
    const onCode = vi.fn();
    const done = h.client.signInWithCode({ onCode });
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
    expect(h.flow().input.device).toEqual({ name: 'ada-mbp', publicKey: '{"kty":"OKP","crv":"Ed25519","x":"pub"}' });
    expect(h.flow().input.onCode).toBe(onCode);
    h.flow().resolve(tokens(1));
    await expect(done).resolves.toEqual({ ok: true });
    expect(h.store.value()).toMatchObject({ refreshToken: 'rt-1', deviceId: 'dev-0', deviceKey: KEY });
    expect(h.client.state()).toEqual({ kind: 'signed-in', email: 'ada@example.com', name: 'Ada', deviceId: 'dev-0' });
    await expect(h.client.getAccessToken()).resolves.toBe('at-1');
  });

  it('reuses the stored device key and id (HIVE-260)', async () => {
    const h = harness({ stored: STORED });
    void h.client.signInWithCode({ onCode: vi.fn() });
    expect(h.flow().input.device.id).toBe('dev-0');
  });

  it('refuses at once without encryption, and asks the cloud nothing', async () => {
    const h = harness({ encryption: false });
    await expect(h.client.signInWithCode({ onCode: vi.fn() })).resolves.toEqual({
      error: expect.any(String),
      failure: 'storage',
    });
    expect(h.runDeviceFlow).not.toHaveBeenCalled();
  });

  it.each(['denied', 'expired', 'network', 'refused'] as const)('a %s flow restores the state before it', async (kind) => {
    const h = harness({ stored: STORED });
    h.client.start();
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    h.flow().reject(new DeviceFlowError(kind));
    await expect(done).resolves.toEqual({ error: expect.any(String), failure: kind });
    expect(h.client.state()).toMatchObject({ kind: 'signed-in' });
  });

  it('cancel() aborts the flow and restores signed-out', async () => {
    const h = harness();
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    h.client.cancel();
    await expect(done).resolves.toMatchObject({ failure: 'aborted' });
    expect(h.client.state()).toEqual({ kind: 'signed-out' });
  });

  it('the caller signal aborts it, even one aborted before the call', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(h.client.signInWithCode({ onCode: vi.fn(), signal: controller.signal })).resolves.toMatchObject({
      failure: 'aborted',
    });
  });

  it('a second call replaces the first, which never lands', async () => {
    const h = harness();
    const first = h.client.signInWithCode({ onCode: vi.fn() });
    const second = h.client.signInWithCode({ onCode: vi.fn() });
    await expect(first).resolves.toMatchObject({ failure: 'aborted' });
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
    h.flow().resolve(tokens(2));
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('a token that cannot be saved signs out with the storage failure', async () => {
    const h = harness({ writable: false });
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    h.flow().resolve(tokens(1));
    await expect(done).resolves.toMatchObject({ failure: 'storage' });
    expect(h.client.state()).toMatchObject({ kind: 'signed-out', reason: 'error' });
  });

  it('signOut during the flow aborts it', async () => {
    const h = harness();
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    await h.client.signOut();
    await expect(done).resolves.toMatchObject({ failure: 'aborted' });
    expect(h.client.state()).toEqual({ kind: 'signed-out' });
  });
});

describe('signInWithCode races (HIVE-266)', () => {
  it('waits for a refresh already in flight, so the rotated token is not lost, then stores the new account', async () => {
    const h = harness({ stored: STORED });
    let resolveRefresh!: (value: TokenResponse) => void;
    h.cloud.token.mockReturnValueOnce(new Promise<TokenResponse>((r) => (resolveRefresh = r)));
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    const refreshing = h.client.getAccessToken();
    h.flow().resolve(tokens(2, { deviceId: 'dev-0' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.value()?.refreshToken).toBe('rt-0');
    resolveRefresh(tokens(1));
    await refreshing;
    await expect(done).resolves.toEqual({ ok: true });
    expect(h.store.value()?.refreshToken).toBe('rt-2');
    await expect(h.client.getAccessToken()).resolves.toBe('at-2');
  });

  it('a sign-out while waiting for that refresh drops the new account', async () => {
    const h = harness({ stored: STORED });
    let resolveRefresh!: (value: TokenResponse) => void;
    h.cloud.token.mockReturnValueOnce(new Promise<TokenResponse>((r) => (resolveRefresh = r)));
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    void h.client.getAccessToken();
    h.flow().resolve(tokens(2));
    await vi.advanceTimersByTimeAsync(0);
    await h.client.signOut();
    resolveRefresh(tokens(1));
    await expect(done).resolves.toMatchObject({ failure: 'aborted' });
    expect(h.store.value()).toBeNull();
    expect(h.client.state()).toEqual({ kind: 'signed-out' });
  });

  it('a refresh landing during the flow keeps signing-in, and cancel returns to the refreshed account', async () => {
    const h = harness({ stored: STORED });
    h.cloud.token.mockResolvedValue(tokens(1));
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    await h.client.getAccessToken();
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
    h.client.cancel();
    await expect(done).resolves.toMatchObject({ failure: 'aborted' });
    expect(h.client.state()).toMatchObject({ kind: 'signed-in', email: 'ada@example.com' });
  });

  it('a device revoked during the flow keeps it open; cancel then returns to the revoked state', async () => {
    const h = harness({ stored: STORED });
    h.cloud.token.mockRejectedValueOnce(new CloudError('invalid_grant', 'device_revoked'));
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    await h.client.getAccessToken();
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
    h.client.cancel();
    await done;
    expect(h.client.state()).toEqual({ kind: 'signed-out', reason: 'device-revoked' });
  });

  it('a browser sign-in replaces a code flow, and returns where the flow would have', async () => {
    const h = harness({ stored: STORED });
    h.client.start();
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    await h.client.signIn();
    await expect(done).resolves.toMatchObject({ failure: 'aborted' });
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
    h.client.cancel();
    expect(h.client.state()).toMatchObject({ kind: 'signed-in' });
  });

  it('a code flow replaces a browser sign-in', async () => {
    const h = harness();
    await h.client.signIn();
    const state = h.lastState();
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    await h.callback(state);
    expect(h.cloud.token).not.toHaveBeenCalled();
    h.flow().resolve(tokens(1));
    await expect(done).resolves.toEqual({ ok: true });
  });

  it('an unexpected throw from the flow is refused, and restores', async () => {
    const h = harness();
    const done = h.client.signInWithCode({ onCode: vi.fn() });
    h.flow().reject(new Error('boom'));
    await expect(done).resolves.toEqual({ error: expect.any(String), failure: 'refused' });
    expect(h.client.state()).toEqual({ kind: 'signed-out' });
  });
  it('the caller signal aborting mid-flow restores the state and stores nothing (Ctrl-C)', async () => {
    const h = harness({ stored: STORED });
    h.client.start();
    const controller = new AbortController();
    const done = h.client.signInWithCode({ onCode: vi.fn(), signal: controller.signal });
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
    controller.abort();
    await expect(done).resolves.toMatchObject({ failure: 'aborted' });
    expect(h.client.state()).toMatchObject({ kind: 'signed-in', deviceId: 'dev-0' });
    expect(h.store.value()).toEqual(STORED);
  });

  it('stops listening to the caller signal once the flow ends', async () => {
    const h = harness();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const done = h.client.signInWithCode({ onCode: vi.fn(), signal: controller.signal });
    h.flow().resolve(tokens(1));
    await done;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('an abort that lands as the token arrives stores nothing', async () => {
    const h = harness();
    const controller = new AbortController();
    let resolveFlow!: (t: TokenResponse) => void;
    h.runDeviceFlow.mockImplementationOnce(() => new Promise<TokenResponse>((r) => (resolveFlow = r)));
    const done = h.client.signInWithCode({ onCode: vi.fn(), signal: controller.signal });
    resolveFlow(tokens(1));
    controller.abort();
    await expect(done).resolves.toMatchObject({ failure: 'aborted' });
    expect(h.store.value()).toBeNull();
    expect(h.client.state()).toEqual({ kind: 'signed-out' });
  });
});

describe('reload (another process wrote account.bin)', () => {
  it('adopts an account that appeared while signed out, and refreshes it', async () => {
    const h = harness();
    h.store.write(STORED);
    h.cloud.token.mockResolvedValue(tokens(1));
    h.client.reload();
    expect(h.client.state()).toEqual({ kind: 'signed-in', email: 'ada@example.com', name: 'Ada', deviceId: 'dev-0' });
    await vi.waitFor(() => expect(h.cloud.token).toHaveBeenCalledWith({ grant_type: 'refresh_token', refresh_token: 'rt-0' }));
  });

  it('signs out when the file is gone', () => {
    const h = harness({ stored: STORED });
    h.client.start();
    h.store.clear();
    h.client.reload();
    expect(h.client.state()).toEqual({ kind: 'signed-out' });
  });

  it('keeps the account when the file is there but cannot be read (a locked keychain)', () => {
    const h = harness({ stored: STORED });
    h.client.start();
    (h.store.read as ReturnType<typeof vi.fn>).mockReturnValue(null); // exists() still true
    h.client.reload();
    expect(h.client.state()).toMatchObject({ kind: 'signed-in' });
    expect(h.store.clear).not.toHaveBeenCalled();
  });

  it('switches to a different account written by --login --force', () => {
    const h = harness({ stored: STORED });
    h.client.start();
    h.store.write({ ...STORED, deviceId: 'dev-9', email: 'bo@example.com', refreshToken: 'rt-9' });
    h.client.reload();
    expect(h.client.state()).toMatchObject({ kind: 'signed-in', email: 'bo@example.com', deviceId: 'dev-9' });
  });

  it('does nothing for the same account, or with nothing stored and nobody signed in', () => {
    const h = harness({ stored: STORED });
    h.client.start();
    const before = h.states.length;
    h.client.reload();
    expect(h.states.length).toBe(before);
    const empty = harness();
    empty.client.reload();
    expect(empty.states).toEqual([]);
  });

  it('stays out of the way while a sign-in of either kind is open', () => {
    const h = harness();
    void h.client.signInWithCode({ onCode: vi.fn() });
    h.store.write(STORED);
    h.client.reload();
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
  });

  it('a refresh of the old account still in flight cannot overwrite the new one', async () => {
    const h = harness({ stored: STORED });
    let resolveOld!: (value: TokenResponse) => void;
    h.cloud.token
      .mockReturnValueOnce(new Promise<TokenResponse>((r) => (resolveOld = r)))
      .mockResolvedValue(tokens(9, { deviceId: 'dev-9', user: { email: 'bo@example.com', name: 'Bo' } }));
    h.client.start();
    const NEW = { ...STORED, deviceId: 'dev-9', email: 'bo@example.com', name: 'Bo', refreshToken: 'rt-new' };
    h.store.write(NEW);
    h.client.reload();
    resolveOld(tokens(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.cloud.token).toHaveBeenLastCalledWith({ grant_type: 'refresh_token', refresh_token: 'rt-new' });
    expect(h.store.value()).toMatchObject({ deviceId: 'dev-9', refreshToken: 'rt-9' });
    expect(h.client.state()).toMatchObject({ kind: 'signed-in', email: 'bo@example.com' });
  });
  it('a new token for the same account and Device (--login --force) drops the old refresh in flight', async () => {
    const h = harness({ stored: STORED });
    let resolveOld!: (value: TokenResponse) => void;
    h.cloud.token
      .mockReturnValueOnce(new Promise<TokenResponse>((r) => (resolveOld = r)))
      .mockResolvedValue(tokens(7));
    h.client.start();
    h.store.write({ ...STORED, refreshToken: 'rt-new' });
    const before = h.states.length;
    h.client.reload();
    expect(h.states.length).toBe(before); // the same account: no flicker
    resolveOld(tokens(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.cloud.token).toHaveBeenLastCalledWith({ grant_type: 'refresh_token', refresh_token: 'rt-new' });
    expect(h.store.value()?.refreshToken).toBe('rt-7');
    await expect(h.client.getAccessToken()).resolves.toBe('at-7');
  });

  it("this process's own rotation is not mistaken for another process's write", async () => {
    const h = harness({ stored: STORED });
    h.cloud.token.mockResolvedValue(tokens(1));
    h.client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.value()?.refreshToken).toBe('rt-1');
    h.client.reload();
    expect(h.cloud.token).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way while a browser sign-in is open', async () => {
    const h = harness();
    await h.client.signIn();
    h.store.write(STORED);
    h.client.reload();
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
  });

  it('stays out of the way while a code exchange is under way', async () => {
    const h = harness({ stored: STORED });
    let resolve!: (value: TokenResponse) => void;
    h.cloud.token.mockReturnValueOnce(new Promise<TokenResponse>((r) => (resolve = r)));
    await h.client.signIn();
    const exchanging = h.callback();
    h.store.write({ ...STORED, deviceId: 'dev-9', email: 'bo@example.com', refreshToken: 'rt-9' });
    h.client.reload();
    expect(h.client.state()).toEqual({ kind: 'signing-in' });
    expect(h.cloud.token).toHaveBeenCalledTimes(1);
    resolve(tokens(1));
    await exchanging;
    expect(h.store.value()?.refreshToken).toBe('rt-1');
  });
});
