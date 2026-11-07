import type { AccountState, DeviceCode, DevicesResult, OpenWebResult, SignInResult } from '@shared/account-contract';

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
