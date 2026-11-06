import type { AccountState, SignInResult } from '@shared/account-contract';

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

export function onAccountChanged(callback: (state: AccountState) => void): () => void {
  return window.hive?.account.onChanged(callback) ?? (() => undefined);
}
