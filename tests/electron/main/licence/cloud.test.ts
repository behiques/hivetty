// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  CLIENT_ID,
  CloudError,
  createCloud,
  DEV_CLOUD_URL,
  PROD_CLOUD_URL,
  resolveCloudUrl,
  stringField,
} from '../../../../electron/main/licence/cloud';

describe('resolveCloudUrl', () => {
  it('uses the prod cloud when packaged and the dev cloud when not', () => {
    expect(resolveCloudUrl({ isPackaged: true, env: {} })).toBe(PROD_CLOUD_URL);
    expect(resolveCloudUrl({ isPackaged: false, env: {} })).toBe(DEV_CLOUD_URL);
    expect(PROD_CLOUD_URL).toBe('https://api.hivetty.dev');
    expect(DEV_CLOUD_URL).toBe('https://api.dev.hivetty.dev');
  });

  it('lets account.cloudUrl override either build, for self-hosted Enterprise', () => {
    expect(resolveCloudUrl({ isPackaged: true, configUrl: 'https://hive.acme.test', env: {} })).toBe(
      'https://hive.acme.test',
    );
  });

  it('honours HIVETTY_CLOUD_URL only when unpackaged', () => {
    const env = { HIVETTY_CLOUD_URL: 'http://127.0.0.1:4010' };
    expect(resolveCloudUrl({ isPackaged: false, env })).toBe('http://127.0.0.1:4010');
    expect(resolveCloudUrl({ isPackaged: true, env })).toBe(PROD_CLOUD_URL);
  });

  it('prefers the config key over the env var', () => {
    expect(
      resolveCloudUrl({
        isPackaged: false,
        configUrl: 'https://hive.acme.test',
        env: { HIVETTY_CLOUD_URL: 'http://127.0.0.1:4010' },
      }),
    ).toBe('https://hive.acme.test');
  });

  it('strips trailing slashes', () => {
    expect(resolveCloudUrl({ isPackaged: true, configUrl: 'https://hive.acme.test//', env: {} })).toBe(
      'https://hive.acme.test',
    );
  });
});

const tokenBody = {
  access_token: 'at-1',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'rt-1',
  device_id: 'dev-1',
  user: { email: 'ada@example.com', name: 'Ada' },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createCloud', () => {
  it('builds the S256 authorize URL with the desktop client', () => {
    const cloud = createCloud({ baseUrl: 'https://c.test', fetch: vi.fn() });
    const url = new URL(
      cloud.authorizeUrl({ redirectUri: 'hivetty://auth/callback', codeChallenge: 'ch', state: 'st' }),
    );
    expect(url.origin + url.pathname).toBe('https://c.test/api/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: 'hivetty://auth/callback',
      response_type: 'code',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      state: 'st',
    });
  });

  it('posts /token form-encoded with client_id and parses the answer', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, tokenBody));
    const cloud = createCloud({ baseUrl: 'https://c.test', fetch });

    await expect(cloud.token({ grant_type: 'refresh_token', refresh_token: 'rt-0' })).resolves.toEqual({
      accessToken: 'at-1',
      expiresIn: 900,
      refreshToken: 'rt-1',
      deviceId: 'dev-1',
      user: { email: 'ada@example.com', name: 'Ada' },
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://c.test/api/oauth/token');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: 'rt-0',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a null user name as empty', async () => {
    const cloud = createCloud({
      baseUrl: 'https://c.test',
      fetch: vi.fn().mockResolvedValue(json(200, { ...tokenBody, user: { email: 'a@b.c', name: null } })),
    });
    await expect(cloud.token({})).resolves.toMatchObject({ user: { email: 'a@b.c', name: '' } });
  });

  it('rejects invalid_grant with its description', async () => {
    const cloud = createCloud({
      baseUrl: 'https://c.test',
      fetch: vi.fn().mockResolvedValue(json(400, { error: 'invalid_grant', error_description: 'device_revoked' })),
    });
    const error = await cloud.token({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect(error).toMatchObject({ kind: 'invalid_grant', description: 'device_revoked' });
  });

  it('rejects any other refusal, a non-JSON body and a malformed answer as refused', async () => {
    const answers = [
      json(400, { error: 'invalid_request' }),
      new Response('<html>bad gateway</html>', { status: 502 }),
      json(200, { access_token: 'x' }),
    ];
    for (const answer of answers) {
      const cloud = createCloud({ baseUrl: 'https://c.test', fetch: vi.fn().mockResolvedValue(answer) });
      await expect(cloud.token({})).rejects.toMatchObject({ kind: 'refused' });
    }
  });

  it('turns a fetch rejection into a network error', async () => {
    const cloud = createCloud({
      baseUrl: 'https://c.test',
      fetch: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    });
    await expect(cloud.token({})).rejects.toMatchObject({ kind: 'network', description: 'fetch failed' });
    await expect(cloud.request('/x')).rejects.toMatchObject({ kind: 'network' });
  });

  it('revokes with the token and the client', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await createCloud({ baseUrl: 'https://c.test', fetch }).revoke('rt-9');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://c.test/api/oauth/revoke');
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      client_id: CLIENT_ID,
      token: 'rt-9',
    });
  });

  it('request passes path and init through, adding a timeout signal', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('ok'));
    await createCloud({ baseUrl: 'https://c.test', fetch }).request('/api/lease', { method: 'POST' });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://c.test/api/lease');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('stringField', () => {
  it('answers a non-empty string member only', () => {
    expect(stringField({ a: 'x' }, 'a')).toBe('x');
    expect(stringField({ a: '' }, 'a')).toBeUndefined();
    expect(stringField({ a: 1 }, 'a')).toBeUndefined();
    expect(stringField(null, 'a')).toBeUndefined();
  });
});
