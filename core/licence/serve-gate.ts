import type { LicenceState } from '@shared/licence-contract';

/**
 * Server mode's listener and the licence (HIVE-265). A machine that has never held a lease serves nothing. One
 * that lapses keeps serving, so its clients see the lapse instead of a dropped connection.
 */
export function startWhenLicensed(
  start: () => void,
  read: () => LicenceState,
  subscribe: (listener: (state: LicenceState) => void) => () => void,
): void {
  if (read().kind !== 'unlicensed') {
    start();
    return;
  }
  const stop = subscribe((state) => {
    if (state.kind === 'unlicensed') return;
    stop();
    start();
  });
}
