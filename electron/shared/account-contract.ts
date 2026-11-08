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

/** The org's subscription, as `GET /api/billing` reports it. `renewsAt` is an ISO string. */
export interface BillingSubscription {
  plan: string;
  status: string;
  interval: 'month' | 'year' | null;
  seats: number;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * `GET /api/billing` for the active org (the Account centre's Plan & billing). `seated` is seats in use; `canManage`
 * says the org has a billing customer. Main answers `null` when the cloud has nothing to show this caller (billing
 * off, not the org's Owner or Billing member, signed out, offline), and the pane falls back to the lease.
 */
export interface BillingSummary {
  orgId: string;
  subscription: BillingSubscription | null;
  canManage: boolean;
  seated: number;
}
