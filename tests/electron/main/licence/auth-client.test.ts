// @vitest-environment node
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountState } from '../../../../electron/shared/account-contract';
import type { AccountStore, StoredAccount } from '../../../../electron/main/licence/account-store';
import {
  createAuthClient,
  generateDeviceKey,
  SIGN_IN_DEADLINE_MS,
} from '../../../../electron/main/licence/auth-client';
import type { Cloud } from '../../../../electron/main/licence/cloud';

const KEY = {
  publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'pub' },
  privateJwk: { kty: 'OKP', crv: 'Ed25519', x: 'pub', d: 'priv' },
};

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
  const client = createAuthClient({
    cloud,
    store,
    encryptionAvailable: () => opts.encryption ?? true,
    openExternal,
    hostname: () => 'ada-mbp',
    randomBytes: (size) => Buffer.alloc(size, ++byte),
    generateDeviceKey: () => KEY,
    scheme: 'hivetty',
  });
  const states: AccountState[] = [];
  client.onChange((state) => states.push(state));
  /** The state the last authorize URL carried. */
  const lastState = () => new URL(openExternal.mock.lastCall![0] as string).searchParams.get('state')!;
  const callback = (state = lastState(), code = 'code-1') =>
    client.handleCallback(`hivetty://auth/callback?code=${code}&state=${state}`);
  return { client, cloud, store, openExternal, states, lastState, callback };
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
