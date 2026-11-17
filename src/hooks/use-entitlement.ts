import { useLicenceLocks } from '@hooks/use-licence-locks';
import { entitlementOf, UPGRADE_PATH } from '@shared/entitlement';

export type EntitlementView =
  | { allowed: true }
  | { allowed: false; reason: string; plan: string | null; upgradeUrl: string };

/**
 * Does the lease grant `feature` (HIVE-268)? Derived on every render, never stored, so a `licence:changed` push
 * re-renders it. `upgradeUrl` is a path for `openAccountWeb`, never a raw link.
 *
 * Read through `useLicenceLocks` (HIVE-429), so a `null` licence locks nothing, as HIVE-332's locks do: the gate
 * is off (the browser, an e2e run without HIVE_E2E_GATE), or the licence is not read yet. Main refuses anyway.
 */
export function useEntitlement(feature: string): EntitlementView {
  const { licence } = useLicenceLocks();
  if (licence === null) return { allowed: true };
  const verdict = entitlementOf(licence, feature);
  return verdict.allowed ? verdict : { ...verdict, upgradeUrl: UPGRADE_PATH };
}
