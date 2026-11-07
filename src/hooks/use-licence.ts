import { useEffect, useState } from 'react';

import { onLicenceChanged, readLicence } from '@lib/licence';
import type { LicenceState } from '@shared/licence-contract';

/**
 * The licence and whether the first read has answered (HIVE-332). Subscribe first, then hydrate, as
 * `useRemoteLinkStream` argues; the read never overwrites a push. `settled` is what a quick-start waits on.
 */
export function useLicenceRead(): { licence: LicenceState | null; settled: boolean } {
  const [state, setState] = useState<{ licence: LicenceState | null; settled: boolean }>({
    licence: null,
    settled: false,
  });
  useEffect(() => {
    let pushed = false;
    const unsubscribe = onLicenceChanged((next) => {
      pushed = true;
      setState({ licence: next, settled: true });
    });
    void readLicence().then((read) => {
      if (!pushed) setState({ licence: read, settled: true });
    });
    return unsubscribe;
  }, []);
  return state;
}

/**
 * The licence (HIVE-267), for HIVE-265's gate and HIVE-268's locks. Local state, not a store slice: it changes
 * about once a day.
 */
export function useLicence(): LicenceState | null {
  return useLicenceRead().licence;
}
