import type {
  AccountState,
  BillingPayments,
  BillingSummary,
  DeviceCode,
  DevicesResult,
  OpenWebResult,
  RevokeResult,
  SignInResult,
} from '@shared/account-contract';
import type { LicenceState } from '@shared/licence-contract';
import type { OrgSummary } from '@shared/orgs';

/**
 * The renderer's door onto the HiveTTY account (HIVE-264); HIVE-265's screens use it.
 * The `updates.ts` shape: no bridge (the browser target) answers `null`, and a refusal from main is logged
 * and answered `null` rather than thrown into a render.
 */

export async function readAccountState(): Promise<AccountState | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.state();
  } catch (cause) {
    console.error('[hive] reading the account failed:', cause);
    return null;
  }
}

/** Resolves once the browser is open; the outcome arrives through {@link onAccountChanged}. */
export async function signIn(): Promise<SignInResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.signIn();
  } catch (cause) {
    console.error('[hive] starting sign-in failed:', cause);
    return null;
  }
}

/** How a code sign-in ended: main returns the failure kind beside the sentence (HIVE-266). */
export type CodeSignInResult = { ok: true } | { error: string; failure?: string };

/** HIVE-266's device flow. Resolves when it ends; the code arrives through {@link onDeviceCode} first. */
export async function signInWithCode(): Promise<CodeSignInResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.signInWithCode();
  } catch (cause) {
    console.error('[hive] starting a code sign-in failed:', cause);
    return null;
  }
}

export function onDeviceCode(callback: (code: DeviceCode) => void): () => void {
  return window.hive?.account.onDeviceCode(callback) ?? (() => undefined);
}

/** HIVE-265: this account's devices, for Account & devices. */
export async function listDevices(): Promise<DevicesResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.devices();
  } catch (cause) {
    console.error('[hive] listing devices failed:', cause);
    return null;
  }
}

/** The Account centre: the org's billing (the personal org without one), or `null` when there is nothing to show. */
export async function readBilling(orgId: string | undefined): Promise<BillingSummary | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.billing(orgId);
  } catch (cause) {
    console.error('[hive] reading billing failed:', cause);
    return null;
  }
}

/** The Account centre: the org's card and last 12 invoices, or `null` when the cloud has none to show. */
export async function readPayments(orgId: string | undefined): Promise<BillingPayments | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.payments(orgId);
  } catch (cause) {
    console.error('[hive] reading payments failed:', cause);
    return null;
  }
}

/** Remove one of this account's other devices. `null` without a bridge or when main throws. */
export async function revokeDevice(id: string): Promise<RevokeResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.revokeDevice(id);
  } catch (cause) {
    console.error('[hive] removing a device failed:', cause);
    return null;
  }
}

/** Manage billing: the org's Stripe portal, else (main decides) the signed-in plan page. */
export async function openBilling(orgId: string | undefined): Promise<OpenWebResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.openBilling(orgId);
  } catch (cause) {
    console.error('[hive] opening billing failed:', cause);
    return null;
  }
}

/** An invoice's PDF or page in the browser; main opens only Stripe's. */
export async function openInvoice(url: string): Promise<OpenWebResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.openInvoice(url);
  } catch (cause) {
    console.error('[hive] opening an invoice failed:', cause);
    return null;
  }
}

/** HIVE-291: the account's orgs, for the switcher. Main answers `[]` when the cloud cannot. */
export async function listOrgs(): Promise<OrgSummary[] | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.orgs();
  } catch (cause) {
    console.error('[hive] listing organisations failed:', cause);
    return null;
  }
}

/** HIVE-291: lease from this org from now on; resolves to the licence after the renewal. */
export async function switchOrg(id: string): Promise<LicenceState | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.switchOrg(id);
  } catch (cause) {
    console.error('[hive] switching organisation failed:', cause);
    return null;
  }
}

/** The avatar's letter: the name's first, else the email's. */
export function initialOf(account: { name: string; email: string }): string {
  return (account.name.trim() || account.email).charAt(0).toUpperCase();
}

export async function cancelSignIn(): Promise<void> {
  try {
    await window.hive?.account.cancel();
  } catch (cause) {
    console.error('[hive] cancelling sign-in failed:', cause);
  }
}

export async function signOut(): Promise<void> {
  try {
    await window.hive?.account.signOut();
  } catch (cause) {
    console.error('[hive] signing out failed:', cause);
  }
}

/** HIVE-268: open a page of the account site, already signed in. HIVE-265 opens `/account` and `/account/devices` the same way. */
export async function openAccountWeb(path: string): Promise<OpenWebResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.account.openWeb(path);
  } catch (cause) {
    console.error('[hive] opening the account site failed:', cause);
    return null;
  }
}

export function onAccountChanged(callback: (state: AccountState) => void): () => void {
  return window.hive?.account.onChanged(callback) ?? (() => undefined);
}
