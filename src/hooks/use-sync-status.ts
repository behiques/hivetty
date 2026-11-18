import { useEffect, useState } from 'react';

import { onSyncStatusChanged, readSyncStatus } from '@lib/sync';
import type { SyncStatus } from '@shared/sync-contract';

/**
 * Settings sync's status for the Sync tab (HIVE-284). Subscribe first, then hydrate, as `useLicenceRead` does;
 * the read never overwrites a push. Local state, not a store slice: only the tab reads it.
 */
export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    let pushed = false;
    const unsubscribe = onSyncStatusChanged((next) => {
      pushed = true;
      setStatus(next);
    });
    void readSyncStatus().then((read) => {
      if (!pushed && read !== null) setStatus(read);
    });
    return unsubscribe;
  }, []);
  return status;
}
