import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { FEATURE_PLANS, PLAN_ORDER, type PlanKey } from '@shared/feature-plans';

export interface StubCall {
  method: string;
  path: string;
  body: Record<string, string>;
  auth?: string;
}

export interface LeaseSpec {
  iat?: number;
  exp?: number;
  plan?: PlanKey;
  trialEnds?: number;
}

export interface StubControls {
  /** `null` refuses every lease with `no_plan`: the state just after sign-in, which puts the welcome up. */
  setPlan(plan: PlanKey | null): void;
  startTrialLease(input: { endsInDays: number }): void;
  /** Sticky until `setPlan`, `issueLease`, `startTrialLease` or `completeCheckout`: a lapsed app keeps asking. */
  refuseNext(reason: string): void;
  issueLease(spec: LeaseSpec): void;
  offline(): Promise<void>;
  online(): Promise<void>;
  revokeDevice(): void;
  approveDeviceCode(): void;
  denyDeviceCode(): void;
  failDeviceCode(): void;
  /** The next device code's `expires_in`, in seconds (600 by default), so a spec can reach the client's `expired`. */
  deviceCodeExpiresIn(seconds: number): void;
  trialUsed(used: boolean): void;
  completeCheckout(plan: PlanKey): void;
}

export interface StubCloud {
  url: string;
  env: { HIVETTY_CLOUD_URL: string; HIVETTY_LEASE_KEYS: string };
  calls: StubCall[];
  controls: StubControls;
  close(): Promise<void>;
}

/**
 * The HiveTTY cloud as the app calls it (HIVE-270), one per test, on 127.0.0.1 and a random port. Shapes are
 * the app's as merged: `electron/main/licence/{cloud,lease,verify,trial,devices,device-flow}.ts` and
 * `auth-client.ts`'s web-session. A control changes what the *next* request gets, never the past.
 */
export const DAY_S = 86_400;
export const nowS = (): number => Math.floor(Date.now() / 1000);
export const STUB_USER = { email: 'ada@example.com', name: 'Ada Lovelace' } as const;

const KID = 'stub-1';
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Compact JWS, ES256 with r||s, as `verify.ts` checks it. */
function signLease(key: KeyObject, claims: Record<string, unknown>): string {
  const input = `${b64({ alg: 'ES256', typ: 'JWT', kid: KID })}.${b64(claims)}`;
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

/** Every feature whose plan ranks at or below `plan`, which is what a real lease for that plan grants. */
const featuresOf = (plan: PlanKey): string[] =>
  Object.entries(FEATURE_PLANS)
    .filter(([, needs]) => PLAN_ORDER.indexOf(needs) <= PLAN_ORDER.indexOf(plan))
    .map(([feature]) => feature);

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return {};
  if ((req.headers['content-type'] ?? '').includes('json')) return JSON.parse(text) as Record<string, string>;
  return Object.fromEntries(new URLSearchParams(text));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export const USER_CODE = 'WDJB-MJHT';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export async function startStubCloud(): Promise<StubCloud> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', kid: KID };

  const state = {
    plan: null as PlanKey | null,
    trialEnds: undefined as number | undefined,
    refusal: null as string | null,
    next: {} as LeaseSpec,
    revoked: false,
    trialUsed: false,
    deviceCode: 'pending' as 'pending' | 'approved' | 'denied' | 'fail',
    codeExpiresIn: 600,
    deviceId: `dev-${randomUUID()}`,
    access: new Set<string>(),
    refresh: new Set<string>(),
  };
  const calls: StubCall[] = [];
  let url = '';
  let deviceCodeDeviceId: string | undefined;

  const lease = (): string => {
    const iat = state.next.iat ?? nowS();
    const trialEnds = state.next.trialEnds ?? state.trialEnds;
    const exp = Math.min(state.next.exp ?? iat + 7 * DAY_S, trialEnds ?? Number.POSITIVE_INFINITY);
    const plan = state.next.plan ?? state.plan ?? 'team';
    return signLease(privateKey, {
      iss: url,
      sub: 'user-ada',
      org: 'org-ada',
      plan,
      device: state.deviceId,
      jti: randomUUID(),
      features: featuresOf(plan),
      limits: {},
      iat,
      exp,
      ...(trialEnds === undefined ? {} : { trialEnds }),
    });
  };

  /** `false` when the bearer is good; otherwise the 401 has already been sent. */
  const unauthorised = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (state.revoked) {
      send(res, 401, { error: 'invalid_token', error_description: 'device_revoked' });
      return true;
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!state.access.has(token)) {
      send(res, 401, { error: 'invalid_token' });
      return true;
    }
    return false;
  };

  /** The code grant's token response, as `parseTokenResponse` reads it. A sent `device_id` is kept (HIVE-266 reuse). */
  const tokens = (sentDeviceId?: string) => {
    if (sentDeviceId) state.deviceId = sentDeviceId;
    const access = `at-${randomUUID()}`;
    const refresh = `rt-${randomUUID()}`;
    state.access.add(access);
    state.refresh.add(refresh);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: 3600,
      device_id: state.deviceId,
      user: STUB_USER,
    };
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? '/', 'http://stub').pathname;
    const body = await readBody(req);
    calls.push({
      method: req.method ?? '',
      path,
      body,
      ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
    });

    if (req.method === 'POST' && path === '/api/lease') {
      if (unauthorised(req, res)) return;
      const reason = state.refusal ?? (state.plan === null && state.next.plan === undefined ? 'no_plan' : null);
      if (reason !== null) return send(res, 403, { error: 'lease_refused', reason });
      return send(res, 200, { lease: lease() });
    }
    if (req.method === 'POST' && path === '/api/oauth/token') {
      if (body.grant_type === 'authorization_code') return send(res, 200, tokens(body.device_id));
      if (body.grant_type === 'refresh_token') {
        if (state.revoked) return send(res, 400, { error: 'invalid_grant', error_description: 'device_revoked' });
        // Rotation, as the real cloud does it: a refresh token is good once, so an app that kept the old one fails.
        if (!state.refresh.delete(body.refresh_token ?? '')) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, tokens());
      }
      if (body.grant_type === DEVICE_GRANT) {
        if (state.deviceCode === 'denied') return send(res, 400, { error: 'access_denied' });
        if (state.deviceCode !== 'approved') return send(res, 400, { error: 'authorization_pending' });
        return send(res, 200, tokens(deviceCodeDeviceId));
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }
    if (req.method === 'POST' && path === '/api/oauth/device/code') {
      if (state.deviceCode === 'fail') return send(res, 500, { error: 'server_error' });
      deviceCodeDeviceId = body.device_id;
      return send(res, 200, {
        device_code: `dc-${randomUUID()}`,
        user_code: USER_CODE,
        verification_uri: `${url}/device`,
        verification_uri_complete: `${url}/device?user_code=${USER_CODE}`,
        expires_in: state.codeExpiresIn,
        interval: 1,
      });
    }
    if (req.method === 'POST' && path === '/api/oauth/revoke') {
      state.refresh.delete(body.token ?? '');
      return send(res, 200, {});
    }
    if (req.method === 'POST' && path === '/api/oauth/web-session') {
      if (unauthorised(req, res)) return;
      return send(res, 200, { url: `${url}/redeem?next=${encodeURIComponent(body.next ?? '/')}` });
    }
    if (req.method === 'POST' && path === '/api/trial') {
      if (unauthorised(req, res)) return;
      if (state.trialUsed) return send(res, 409, { error: 'trial_used' });
      state.trialUsed = true;
      Object.assign(state, { plan: 'team', trialEnds: nowS() + 14 * DAY_S, refusal: null, next: {} });
      return send(res, 201, {});
    }
    if (req.method === 'GET' && path === '/api/account/devices') {
      if (unauthorised(req, res)) return;
      const at = new Date().toISOString();
      return send(res, 200, {
        devices: [{ id: state.deviceId, name: 'Test Mac', lastSeenAt: at, createdAt: at, current: true }],
      });
    }
    send(res, 404, { error: 'not_found' });
  };

  const server = createServer((req, res) => {
    route(req, res).catch((cause: unknown) => send(res, 500, { error: String(cause) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  url = `http://127.0.0.1:${String(port)}`;

  const closeServer = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });

  const controls: StubControls = {
    setPlan: (plan) => Object.assign(state, { plan, trialEnds: undefined, refusal: null, next: {} }),
    startTrialLease: ({ endsInDays }) =>
      // Less a minute, so `trialDaysLeft`'s ceil reads exactly `endsInDays`.
      Object.assign(state, { plan: 'team', trialEnds: nowS() + endsInDays * DAY_S - 60, refusal: null, next: {} }),
    refuseNext: (reason) => (state.refusal = reason),
    issueLease: (spec) => Object.assign(state, { next: spec, refusal: null }),
    offline: closeServer,
    online: () => new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve)),
    revokeDevice: () => (state.revoked = true),
    approveDeviceCode: () => (state.deviceCode = 'approved'),
    denyDeviceCode: () => (state.deviceCode = 'denied'),
    failDeviceCode: () => (state.deviceCode = 'fail'),
    deviceCodeExpiresIn: (seconds) => (state.codeExpiresIn = seconds),
    trialUsed: (used) => (state.trialUsed = used),
    completeCheckout: (plan) => Object.assign(state, { plan, trialEnds: undefined, refusal: null, next: {} }),
  };

  return {
    url,
    env: { HIVETTY_CLOUD_URL: url, HIVETTY_LEASE_KEYS: JSON.stringify([jwk]) },
    calls,
    controls,
    close: closeServer,
  };
}
