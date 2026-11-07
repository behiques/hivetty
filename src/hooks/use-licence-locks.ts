import { useGateOff } from '@hooks/use-gate-off';
import { useLicenceRead } from '@hooks/use-licence';
import type { LicenceState } from '@shared/licence-contract';

/**
 * The licence plan locks are drawn from (HIVE-332). `null` locks nothing: the gate is off (the browser, or an e2e run
 * without HIVE_E2E_GATE), or the licence is not read yet — main refuses regardless, as detection's D10 counts an
 * unanswered CLI as found. `settled` is when a quick-start may trust it.
 */
export function useLicenceLocks(): { licence: LicenceState | null; settled: boolean } {
  const off = useGateOff();
  const { licence, settled } = useLicenceRead();
  if (off === true) return { licence: null, settled: true };
  return { licence: off === false ? licence : null, settled: off === false && settled };
}
