import type { DeviceCode } from '@shared/account-contract';

import { type Cloud, CLIENT_ID, parseTokenResponse, stringField, type TokenResponse } from './cloud';

/**
 * RFC 8628 against the HiveTTY cloud (HIVE-266, HIVE-260): the one device-flow client, for `hivetty --login` and
 * `account:sign-in-code` alike. Pure: the request, the clock and the wait are injected.
 */

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
export const DEFAULT_INTERVAL_S = 5;
/** RFC 8628 §3.5, and the cloud's SLOW_DOWN_STEP_SECONDS. */
export const SLOW_DOWN_S = 5;

export type DeviceFlowFailure = 'denied' | 'expired' | 'network' | 'refused' | 'aborted';

export class DeviceFlowError extends Error {
  readonly kind: DeviceFlowFailure;

  constructor(kind: DeviceFlowFailure, detail?: string) {
    super(detail ? `${kind}: ${detail}` : kind);
    this.kind = kind;
    this.name = 'DeviceFlowError';
  }
}

export interface DeviceFlowDeps {
  request: Cloud['request'];
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
}

export interface DeviceFlowInput {
  device: { name: string; publicKey: string; id?: string };
  onCode: (code: DeviceCode) => void;
  signal: AbortSignal;
}

/** A wait that rejects the moment `signal` aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DeviceFlowError('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DeviceFlowError('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const positive = (body: unknown, name: string): number | undefined => {
  const value = (body as Record<string, unknown> | null)?.[name];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
};

async function post(
  deps: DeviceFlowDeps,
  path: string,
  fields: Record<string, string>,
  signal: AbortSignal,
): Promise<{ ok: boolean; body: unknown }> {
  let response: Response;
  try {
    response = await deps.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }).toString(),
    });
  } catch (cause) {
    if (signal.aborted) throw new DeviceFlowError('aborted');
    throw new DeviceFlowError('network', cause instanceof Error ? cause.message : String(cause));
  }
  // An answer that lands after a cancel belongs to nobody.
  if (signal.aborted) throw new DeviceFlowError('aborted');
  const body: unknown = await response.json().catch(() => null);
  if (signal.aborted) throw new DeviceFlowError('aborted');
  return { ok: response.ok, body };
}

export async function runDeviceFlow(deps: DeviceFlowDeps, input: DeviceFlowInput): Promise<TokenResponse> {
  const { device, onCode, signal } = input;
  if (signal.aborted) throw new DeviceFlowError('aborted');
  const fields: Record<string, string> = { device_name: device.name, device_public_key: device.publicKey };
  if (device.id) fields.device_id = device.id;

  const start = await post(deps, '/api/oauth/device/code', fields, signal);
  const deviceCode = stringField(start.body, 'device_code');
  const userCode = stringField(start.body, 'user_code');
  const verificationUri = stringField(start.body, 'verification_uri');
  const expiresIn = positive(start.body, 'expires_in');
  if (!start.ok || !deviceCode || !userCode || !verificationUri || !expiresIn) {
    throw new DeviceFlowError(
      'refused',
      stringField(start.body, 'error_description') ?? stringField(start.body, 'error') ?? 'the cloud issued no code',
    );
  }
  const deadline = deps.now() + expiresIn * 1000;
  // A sub-second interval, or one past the code's life (1e10 s overflows a Node timer to 1 ms), would hammer the
  // token endpoint for the whole wait: anything outside [1 s, expires_in] is the default.
  const offered = positive(start.body, 'interval');
  let intervalMs =
    (offered !== undefined && offered >= 1 && offered <= expiresIn ? offered : DEFAULT_INTERVAL_S) * 1000;
  onCode({
    userCode,
    verificationUri,
    verificationUriComplete:
      stringField(start.body, 'verification_uri_complete') ??
      `${verificationUri}?${new URLSearchParams({ code: userCode }).toString()}`,
    expiresIn,
  });

  // A dropped request or an error-less 5xx in a ten-minute wait is weather, not an answer: keep polling, and only
  // if the failure lasts to the deadline does it become the outcome.
  let transient: DeviceFlowError | undefined;
  for (;;) {
    try {
      await deps.sleep(intervalMs, signal);
    } catch {
      throw new DeviceFlowError('aborted');
    }
    if (signal.aborted) throw new DeviceFlowError('aborted');
    if (deps.now() >= deadline) throw transient ?? new DeviceFlowError('expired');
    let poll: { ok: boolean; body: unknown };
    try {
      poll = await post(deps, '/api/oauth/token', { grant_type: DEVICE_GRANT, device_code: deviceCode }, signal);
    } catch (failure) {
      if (failure instanceof DeviceFlowError && failure.kind === 'network') {
        transient = failure;
        continue;
      }
      throw failure;
    }
    if (!poll.ok && stringField(poll.body, 'error') === undefined) {
      transient = new DeviceFlowError('refused', stringField(poll.body, 'error_description') ?? 'the cloud refused');
      continue;
    }
    transient = undefined;
    if (poll.ok) {
      const token = parseTokenResponse(poll.body);
      if (!token) throw new DeviceFlowError('refused', 'the cloud answered with something that is not a token');
      return token;
    }
    const error = stringField(poll.body, 'error');
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') {
      intervalMs += SLOW_DOWN_S * 1000;
      continue;
    }
    if (error === 'access_denied') throw new DeviceFlowError('denied');
    if (error === 'expired_token' || error === 'invalid_grant') throw new DeviceFlowError('expired');
    throw new DeviceFlowError('refused', stringField(poll.body, 'error_description') ?? error ?? 'the cloud refused');
  }
}
