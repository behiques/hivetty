// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  DEVICE_GRANT,
  runDeviceFlow,
  type DeviceFlowDeps,
} from '../../../../electron/main/licence/device-flow';

const CODE = {
  device_code: 'dc-1',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://c.test/device',
  verification_uri_complete: 'https://c.test/device?code=WDJB-MJHT',
  expires_in: 600,
  interval: 5,
};
const TOKEN = {
  access_token: 'at-1',
  expires_in: 900,
  refresh_token: 'rt-1',
  device_id: 'dev-1',
  user: { email: 'ana@example.com', name: 'Ana' },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each request from the queue in order; records the form of each. */
function harness(answers: (Response | Error)[], opts: { clockStep?: number } = {}) {
  const forms: { path: string; form: Record<string, string> }[] = [];
  let clock = 0;
  const sleeps: number[] = [];
  const deps: DeviceFlowDeps = {
    request: vi.fn(async (path: string, init?: RequestInit) => {
      forms.push({ path, form: Object.fromEntries(new URLSearchParams(String(init?.body))) });
      const next = answers.shift();
      if (!next) throw new Error('no answer queued');
      if (next instanceof Error) throw next;
      return next;
    }),
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
      clock += opts.clockStep ?? ms;
    }),
    now: () => clock,
  };
  return { deps, forms, sleeps };
}

const input = (over: Partial<Parameters<typeof runDeviceFlow>[1]> = {}) => ({
  device: { name: 'studio-mac', publicKey: '{"kty":"OKP","crv":"Ed25519","x":"pub"}' },
  onCode: vi.fn(),
  signal: new AbortController().signal,
  ...over,
});

describe('runDeviceFlow', () => {
  it('asks for a code, shows it, polls past pending and returns the token', async () => {
    const { deps, forms, sleeps } = harness([
      json(200, CODE),
      json(400, { error: 'authorization_pending' }),
      json(200, TOKEN),
    ]);
    const args = input();
    const token = await runDeviceFlow(deps, args);

    expect(token).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1', deviceId: 'dev-1' });
    expect(args.onCode).toHaveBeenCalledExactlyOnceWith({
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://c.test/device',
      verificationUriComplete: 'https://c.test/device?code=WDJB-MJHT',
      expiresIn: 600,
    });
    expect(forms[0]).toEqual({
      path: '/api/oauth/device/code',
      form: {
        client_id: 'hivetty-desktop',
        device_name: 'studio-mac',
        device_public_key: '{"kty":"OKP","crv":"Ed25519","x":"pub"}',
      },
    });
    expect(forms[1]).toEqual({
      path: '/api/oauth/token',
      form: { client_id: 'hivetty-desktop', grant_type: DEVICE_GRANT, device_code: 'dc-1' },
    });
    expect(sleeps).toEqual([5000, 5000]);
  });

  it('sends device_id when the store holds one (HIVE-260: the Device is reused)', async () => {
    const { deps, forms } = harness([json(200, CODE), json(200, TOKEN)]);
    await runDeviceFlow(deps, input({ device: { name: 'studio-mac', publicKey: '{}', id: 'dev-1' } }));
    expect(forms[0]!.form.device_id).toBe('dev-1');
  });

  it('slow_down adds five seconds to every later wait', async () => {
    const { deps, sleeps } = harness([
      json(200, CODE),
      json(400, { error: 'slow_down' }),
      json(400, { error: 'authorization_pending' }),
      json(200, TOKEN),
    ]);
    await runDeviceFlow(deps, input());
    // The first wait is the cloud's 5 s; slow_down makes every wait after it 10 s.
    expect(sleeps).toEqual([5000, 10000, 10000]);
  });

  it('falls back to a five-second interval and builds the complete URL when the cloud omits them', async () => {
    const { deps, sleeps } = harness([
      json(200, { ...CODE, interval: undefined, verification_uri_complete: undefined }),
      json(200, TOKEN),
    ]);
    const args = input();
    await runDeviceFlow(deps, args);
    expect(sleeps).toEqual([5000]);
    expect(args.onCode).toHaveBeenCalledWith(
      expect.objectContaining({ verificationUriComplete: 'https://c.test/device?code=WDJB-MJHT' }),
    );
  });
});
