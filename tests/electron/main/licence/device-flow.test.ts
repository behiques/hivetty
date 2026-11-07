// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { CloudError } from '../../../../electron/main/licence/cloud';
import {
  abortableSleep,
  DEVICE_GRANT,
  DeviceFlowError,
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
  it.each([
    ['access_denied', 'denied'],
    ['expired_token', 'expired'],
    ['invalid_grant', 'expired'],
    ['server_error', 'refused'],
  ] as const)('a poll answering %s ends as %s', async (error, kind) => {
    const { deps } = harness([json(200, CODE), json(400, { error })]);
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind });
  });

  it('a code request the cloud refuses is refused, with its description', async () => {
    const { deps } = harness([json(400, { error: 'invalid_request', error_description: 'device_name is too long' })]);
    const failure = runDeviceFlow(deps, input());
    await expect(failure).rejects.toBeInstanceOf(DeviceFlowError);
    await expect(failure).rejects.toMatchObject({ kind: 'refused', message: 'refused: device_name is too long' });
  });

  it('a 200 code answer missing its fields is refused', async () => {
    const { deps } = harness([json(200, { user_code: 'X' })]);
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind: 'refused' });
  });

  it('a 200 poll that is not a token is refused', async () => {
    const { deps } = harness([json(200, CODE), json(200, { access_token: 'only' })]);
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind: 'refused' });
  });

  it('a transport failure on the code request is network', async () => {
    const { deps } = harness([new CloudError('network', 'ECONNREFUSED')]);
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind: 'network' });
  });

  it('a transient poll failure keeps polling: a dropped request or an error-less 5xx', async () => {
    const { deps, forms } = harness([
      json(200, CODE),
      new CloudError('network', 'ETIMEDOUT'),
      new Response('bad gateway', { status: 502 }),
      json(503, {}),
      json(200, TOKEN),
    ]);
    await expect(runDeviceFlow(deps, input())).resolves.toMatchObject({ accessToken: 'at-1' });
    expect(forms).toHaveLength(5);
  });

  it('poll failures that last to the deadline end as the last failure, not expired', async () => {
    // Each sleep advances 400 s: polls at 400 s, then the 800 s check crosses expires_in 600.
    const network = harness([json(200, CODE), new CloudError('network', 'ETIMEDOUT')], { clockStep: 400_000 });
    await expect(runDeviceFlow(network.deps, input())).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('ETIMEDOUT'),
    });
    const server = harness([json(200, CODE), new Response('not json', { status: 500 })], { clockStep: 400_000 });
    await expect(runDeviceFlow(server.deps, input())).rejects.toMatchObject({
      kind: 'refused',
      message: 'refused: the cloud refused',
    });
  });

  it('a pending poll after a transient failure clears it, so the deadline is expired again', async () => {
    const { deps } = harness(
      [json(200, CODE), new CloudError('network', 'ETIMEDOUT'), json(400, { error: 'authorization_pending' })],
      { clockStep: 250_000 },
    );
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind: 'expired' });
  });

  it('expires locally once expires_in has passed, without another poll', async () => {
    // Each sleep advances the clock 400 s: the second wait crosses 600 s.
    const { deps, forms } = harness(
      [json(200, { ...CODE, expires_in: 600 }), json(400, { error: 'authorization_pending' })],
      { clockStep: 400_000 },
    );
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind: 'expired' });
    expect(forms).toHaveLength(2); // the code request and one poll
  });

  it('an abort during the wait stops polling', async () => {
    const controller = new AbortController();
    const { deps, forms } = harness([json(200, CODE)]);
    deps.sleep = vi.fn(async () => {
      controller.abort();
      throw new DeviceFlowError('aborted');
    });
    await expect(runDeviceFlow(deps, input({ signal: controller.signal }))).rejects.toMatchObject({ kind: 'aborted' });
    expect(forms).toHaveLength(1);
  });

  it('an answer that lands after an abort is dropped', async () => {
    const controller = new AbortController();
    const { deps } = harness([json(200, CODE), json(200, TOKEN)]);
    deps.sleep = vi.fn(async () => undefined);
    const request = deps.request;
    deps.request = vi.fn(async (path: string, init?: RequestInit) => {
      const response = await request(path, init);
      if (path === '/api/oauth/token') controller.abort();
      return response;
    });
    await expect(runDeviceFlow(deps, input({ signal: controller.signal }))).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('an already-aborted signal asks for nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, forms } = harness([]);
    await expect(runDeviceFlow(deps, input({ signal: controller.signal }))).rejects.toMatchObject({ kind: 'aborted' });
    expect(forms).toHaveLength(0);
  });
  it('a token body that finishes reading after an abort is dropped', async () => {
    const controller = new AbortController();
    const { deps } = harness([json(200, CODE)]);
    deps.sleep = vi.fn(async () => undefined);
    const request = deps.request;
    deps.request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path !== '/api/oauth/token') return request(path, init);
      const response = json(200, TOKEN);
      const read = response.json.bind(response);
      response.json = async () => {
        controller.abort();
        return read();
      };
      return response;
    });
    await expect(runDeviceFlow(deps, input({ signal: controller.signal }))).rejects.toMatchObject({ kind: 'aborted' });
  });
  it('a transport failure after an abort is aborted, not network', async () => {
    const controller = new AbortController();
    const { deps } = harness([]);
    deps.request = vi.fn(async () => {
      controller.abort();
      throw new CloudError('network', 'socket closed');
    });
    await expect(runDeviceFlow(deps, input({ signal: controller.signal }))).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('a transport failure that is not an Error is still network, described', async () => {
    const { deps } = harness([]);
    deps.request = vi.fn(async () => Promise.reject('ECONNRESET' as unknown as Error));
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind: 'network', message: 'network: ECONNRESET' });
  });

  it('a wait that ends normally after an abort still stops before polling', async () => {
    const controller = new AbortController();
    const { deps, forms } = harness([json(200, CODE)]);
    deps.sleep = vi.fn(async () => {
      controller.abort();
    });
    await expect(runDeviceFlow(deps, input({ signal: controller.signal }))).rejects.toMatchObject({ kind: 'aborted' });
    expect(forms).toHaveLength(1);
  });

  it.each([
    [{ error: 'server_error', error_description: 'try later' }, 'refused: try later'],
    [{ error: 'server_error' }, 'refused: server_error'],
  ])('a refused poll carries the best description it has (%o)', async (body, message) => {
    const { deps } = harness([json(200, CODE), json(400, body)]);
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind: 'refused', message });
  });

  it.each([
    [{ error: 'invalid_client' }, 'refused: invalid_client'],
    [{}, 'refused: the cloud issued no code'],
  ])('a refused code request carries the best description it has (%o)', async (body, message) => {
    const { deps } = harness([json(400, body)]);
    await expect(runDeviceFlow(deps, input())).rejects.toMatchObject({ kind: 'refused', message });
  });
});

describe('abortableSleep', () => {
  it('resolves after the wait, and rejects at once on abort', async () => {
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      void abortableSleep(5000, new AbortController().signal).then(done);
      await vi.advanceTimersByTimeAsync(5000);
      expect(done).toHaveBeenCalled();

      const controller = new AbortController();
      const waiting = abortableSleep(5000, controller.signal);
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ kind: 'aborted' });

      await expect(abortableSleep(1, controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
    } finally {
      vi.useRealTimers();
    }
  });
});
