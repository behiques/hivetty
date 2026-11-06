import { useEffect, useState } from 'react';

import { onLicenceChanged, readLicence } from '@lib/licence';
import type { LicenceState } from '@shared/licence-contract';

/**
 * The licence (HIVE-267), for HIVE-265's gate and HIVE-268's locks. Subscribe first, then hydrate, as
 * `useRemoteLinkStream` argues; the read never overwrites a push. Local state, not a store slice: it changes
 * about once a day.
 */
export function useLicence(): LicenceState | null {
  const [state, setState] = useState<LicenceState | null>(null);
  useEffect(() => {
    let pushed = false;
    const unsubscribe = onLicenceChanged((next) => {
      pushed = true;
      setState(next);
    });
    void readLicence().then((read) => {
      if (!pushed && read !== null) setState(read);
    });
    return unsubscribe;
  }, []);
  return state;
}
