import type { LicenceState } from '@shared/licence-contract';

/**
 * The renderer's door onto the licence (HIVE-267); HIVE-265's gate and HIVE-268's locks use it.
 * The `account.ts` shape: no bridge (the browser target) answers `null`, and a refusal from main is logged
 * and answered `null` rather than thrown into a render.
 */

export async function readLicence(): Promise<LicenceState | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.licence.state();
  } catch (cause) {
    console.error('[hive] reading the licence failed:', cause);
    return null;
  }
}

/** Renews the lease now; resolves to the state after. */
export async function refreshLicence(): Promise<LicenceState | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.licence.refresh();
  } catch (cause) {
    console.error('[hive] renewing the licence failed:', cause);
    return null;
  }
}

/** HIVE-265's Choose a plan: `true` renews every 5 s for up to 15 min, `false` stops. */
export async function watchPurchase(on: boolean): Promise<void> {
  try {
    await window.hive?.licence.watchPurchase(on);
  } catch (cause) {
    console.error('[hive] watching for a purchase failed:', cause);
  }
}

export function onLicenceChanged(callback: (state: LicenceState) => void): () => void {
  return window.hive?.licence.onChanged(callback) ?? (() => undefined);
}
