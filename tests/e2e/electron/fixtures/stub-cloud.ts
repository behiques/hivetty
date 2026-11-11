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
  /** HIVE-291: GET /api/orgs answers these; a lease signs for the asked org when it seats the caller, else the first seated. */
  setOrgs(orgs: StubOrg[]): void;
  /** The Account center: GET /api/billing answers this summary for any org; `null` (the default) answers 404, billing off. */
  setBilling(summary: Record<string, unknown> | null): void;
  /** GET /api/billing/payments answers this card and invoices; `null` (the default) answers 404, an older cloud. */
  setPayments(payments: Record<string, unknown> | null): void;
  /** Another device on the account, listed after this one; POST /api/account/devices/:id/revoke removes it. */
  addDevice(device: { id: string; name: string }): void;
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
 * the app's as merged: `electron/main/licence/{cloud,lease,verify,trial,devices,device-flow,orgs}.ts` and
 * `auth-client.ts`'s web-session. A control changes what the *next* request gets, never the past.
 */
export const DAY_S = 86_400;
export const nowS = (): number => Math.floor(Date.now() / 1000);
export const STUB_USER = { email: 'ada@example.com', name: 'Ada Lovelace' } as const;

/** HIVE-291: one row of GET /api/orgs, as hivetty-cloud's `OrgRow`. */
export interface StubOrg {
  id: string;
  name: string;
  role: string;
  seat: boolean;
  /** `null` leases on the stub's own plan (`setPlan`, a trial, a checkout), as the default org does. */
  plan: PlanKey | null;
  status: string | null;
  personal: boolean;
}

/** The caller's one org until `setOrgs`: the `org-ada` every lease carried before HIVE-291. */
export const DEFAULT_ORG: StubOrg = {
  id: 'org-ada',
  name: 'Ada Lovelace',
  role: 'Owner',
  seat: true,
  plan: null,
  status: null,
  personal: true,
};

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
    orgs: [DEFAULT_ORG] as StubOrg[],
    billing: null as Record<string, unknown> | null,
    payments: null as Record<string, unknown> | null,
    otherDevices: [] as { id: string; name: string }[],
  };
  const calls: StubCall[] = [];
  let url = '';
  let deviceCodeDeviceId: string | undefined;

  const lease = (plan: PlanKey, org: string): string => {
    const iat = state.next.iat ?? nowS();
    const trialEnds = state.next.trialEnds ?? state.trialEnds;
    const exp = Math.min(state.next.exp ?? iat + 7 * DAY_S, trialEnds ?? Number.POSITIVE_INFINITY);
    return signLease(privateKey, {
      iss: url,
      sub: 'user-ada',
      org,
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
      // HIVE-291: the asked org when it seats the caller, else the first seated one, as the cloud's `decide`.
      const seated = state.orgs.filter((org) => org.seat);
      const granted = seated.find((org) => org.id === body.org) ?? seated[0];
      const plan = state.next.plan ?? granted?.plan ?? state.plan;
      if (state.refusal !== null) return send(res, 403, { error: 'lease_refused', reason: state.refusal });
      if (plan === null) return send(res, 403, { error: 'lease_refused', reason: 'no_plan' });
      return send(res, 200, { lease: lease(plan, granted?.id ?? DEFAULT_ORG.id) });
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
        devices: [
          { id: state.deviceId, name: 'Test Mac', lastSeenAt: at, createdAt: at, current: true },
          ...state.otherDevices.map((device) => ({ ...device, lastSeenAt: at, createdAt: at, current: false })),
        ],
      });
    }
    const revoke = /^\/api\/account\/devices\/([^/]+)\/revoke$/.exec(path);
    if (req.method === 'POST' && revoke) {
      if (unauthorised(req, res)) return;
      const id = decodeURIComponent(revoke[1] ?? '');
      const before = state.otherDevices.length;
      state.otherDevices = state.otherDevices.filter((device) => device.id !== id);
      if (state.otherDevices.length === before) return send(res, 404, { error: 'not_found' });
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'GET' && path === '/api/billing/payments') {
      if (unauthorised(req, res)) return;
      return state.payments ? send(res, 200, state.payments) : send(res, 404, { error: 'not_found' });
    }
    if (req.method === 'GET' && path === '/api/orgs') {
      if (unauthorised(req, res)) return;
      return send(res, 200, { orgs: state.orgs });
    }
    if (req.method === 'GET' && path === '/api/billing') {
      if (unauthorised(req, res)) return;
      return state.billing ? send(res, 200, state.billing) : send(res, 404, { error: 'not_found' });
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
    setOrgs: (orgs) => (state.orgs = orgs),
    setBilling: (summary) => (state.billing = summary),
    setPayments: (payments) => (state.payments = payments),
    addDevice: (device) => state.otherDevices.push(device),
  };

  return {
    url,
    env: { HIVETTY_CLOUD_URL: url, HIVETTY_LEASE_KEYS: JSON.stringify([jwk]) },
    calls,
    controls,
    close: closeServer,
  };
}
