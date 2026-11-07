import type { AccountState, DeviceCode } from '@shared/account-contract';
import type { LapseReason, LicenceState } from '@shared/licence-contract';

export type LapsedReason = Exclude<LapseReason, 'signed_out' | 'device_revoked' | 'no_plan'>;

export type GateView =
  | { kind: 'loading' }
  | { kind: 'open' }
  | { kind: 'waiting-browser' }
  /** `null`: asked, no code yet ("Getting a code…"). */
  | { kind: 'waiting-code'; code: DeviceCode | null }
  | { kind: 'revoked' }
  | { kind: 'sign-in'; message?: string }
  | { kind: 'welcome'; firstName: string; email: string }
  | { kind: 'lapsed'; reason: LapsedReason; email: string; checkedAt?: number };

/** The renderer's own record of a code sign-in (HIVE-266's flow): main keeps the account at `signing-in` with no code. */
export interface CodeFlow {
  active: boolean;
  code: DeviceCode | null;
  error: string | null;
}

export const firstName = (account: { name: string; email: string }): string =>
  account.name.trim().split(/\s+/)[0] || account.email;

/**
 * Which gate, if any (HIVE-265). `null` is loading, never a gate: HIVE-267 says so. The order matters: a sign-in
 * under way outranks the revoked screen it was started from, and revoked outranks a plain sign-out.
 */
export function gateView(
  account: AccountState | null,
  licence: LicenceState | null,
  flow: CodeFlow = { active: false, code: null, error: null },
): GateView {
  if (account === null || licence === null) return { kind: 'loading' };
  if (licence.kind === 'licensed' || licence.kind === 'grace') return { kind: 'open' };
  if (account.kind === 'signing-in') {
    return flow.active ? { kind: 'waiting-code', code: flow.code } : { kind: 'waiting-browser' };
  }
  const revoked =
    (licence.kind === 'lapsed' && licence.reason === 'device_revoked') ||
    (account.kind === 'signed-out' && account.reason === 'device-revoked');
  if (revoked) return { kind: 'revoked' };
  if (account.kind === 'signed-out') {
    const message = flow.error ?? (account.reason === 'timeout' ? 'Sign-in timed out. Try again.' : account.message);
    return message ? { kind: 'sign-in', message } : { kind: 'sign-in' };
  }
  if (licence.kind === 'unlicensed' || licence.reason === 'no_plan') {
    return { kind: 'welcome', firstName: firstName(account), email: account.email };
  }
  // Signed back in a moment ago; the licence re-reads the lease file next.
  if (licence.reason === 'signed_out') return { kind: 'loading' };
  return {
    kind: 'lapsed',
    reason: licence.reason as LapsedReason,
    email: account.email,
    ...(licence.checkedAt === undefined ? {} : { checkedAt: licence.checkedAt }),
  };
}
