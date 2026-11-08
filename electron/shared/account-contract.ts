/**
 * The signed-in account, as main reports it to the renderer (HIVE-264).
 * Types only: the renderer imports this file type-only.
 */
export type SignedOutReason = 'device-revoked' | 'timeout' | 'error';

export type AccountState =
  | { kind: 'signed-out'; reason?: SignedOutReason; message?: string }
  | { kind: 'signing-in' }
  /** HIVE-291 D6: `activeOrg` is the org asked for, which the lease may not have granted. */
  | { kind: 'signed-in'; email: string; name: string; deviceId: string; activeOrg?: string };

/** `account:sign-in` resolves once the browser is open; the outcome arrives on `account:changed`. */
export type SignInResult = { ok: true } | { error: string };

/** `account:open-web` (HIVE-268): opens a page of the cloud's site in the browser, already signed in. */
export type OpenWebResult = { ok: true } | { error: string };

/** `account:device-code` (HIVE-266): what the person types, and where, for a device-flow sign-in. */
export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** Seconds the code lives. */
  expiresIn: number;
}

/** `licence:start-trial`. `trial_used` and `already_subscribed` are the cloud's 409 codes; anything else is a sentence. */
export type TrialResult = { ok: true } | { error: string };

/** One row of `GET /api/account/devices`. Dates are ISO strings. */
export interface AccountDevice {
  id: string;
  name: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

export type DevicesResult = { devices: AccountDevice[] } | { error: string };
