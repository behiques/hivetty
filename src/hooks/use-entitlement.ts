import { useLicence } from '@hooks/use-licence';
import { entitlementOf, UPGRADE_PATH } from '@shared/entitlement';

export type EntitlementView =
  | { allowed: true }
  | { allowed: false; reason: string; plan: string | null; upgradeUrl: string };

/**
 * Does the lease grant `feature` (HIVE-268)? Derived from `useLicence()` on every render, never stored, so a
 * `licence:changed` push re-renders it. `upgradeUrl` is a path for `openAccountWeb`, never a raw link.
 */
export function useEntitlement(feature: string): EntitlementView {
  const verdict = entitlementOf(useLicence(), feature);
  return verdict.allowed ? verdict : { ...verdict, upgradeUrl: UPGRADE_PATH };
}
