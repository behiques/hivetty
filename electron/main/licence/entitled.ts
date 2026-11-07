import { entitlementOf } from '@shared/entitlement';

import { licence } from './index';

/**
 * Does the lease grant `feature`? `null` means yes; otherwise the sentence a person reads (HIVE-268). Reads
 * through `licence()`, the only licence read. HIVE-332 wires `agents/cli-gate.ts`'s `entitled` to this.
 */
export function entitled(feature: string): string | null {
  const verdict = entitlementOf(licence(), feature);
  return verdict.allowed ? null : verdict.reason;
}
