import { cliEntitlementOf, entitlementOf } from '@shared/entitlement';
import type { HarnessId } from '@shared/harness-contract';

import { licence } from './index';

/**
 * Does the lease grant `feature`? `null` means yes; otherwise the sentence a person reads (HIVE-268). Reads
 * through `licence()`, the only licence read.
 */
export function entitled(feature: string): string | null {
  const verdict = entitlementOf(licence(), feature);
  return verdict.allowed ? null : verdict.reason;
}

/** May this CLI run (HIVE-332)? `null` means yes; else the reason a person reads. Same single licence read. */
export function cliEntitled(id: HarnessId): string | null {
  const verdict = cliEntitlementOf(licence(), id);
  return verdict.allowed ? null : verdict.reason;
}
