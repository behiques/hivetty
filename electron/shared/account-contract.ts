/**
 * The signed-in account, as main reports it to the renderer (HIVE-264).
 * Types only: the renderer imports this file type-only.
 */
export type SignedOutReason = 'device-revoked' | 'timeout' | 'error';

export type AccountState =
  | { kind: 'signed-out'; reason?: SignedOutReason; message?: string }
  | { kind: 'signing-in' }
  | { kind: 'signed-in'; email: string; name: string; deviceId: string };

/** `account:sign-in` resolves once the browser is open; the outcome arrives on `account:changed`. */
export type SignInResult = { ok: true } | { error: string };
