import { useEffect, useSyncExternalStore } from 'react';

import { loadSwarms, subscribeSwarms, swarmsSnapshot, type SwarmsSnapshot } from '@/lib/swarms';

/** The installed swarms and the registry (HIVE-442). Mounting it reads the list; `swarms:changed` keeps it fresh. */
export function useSwarms(): SwarmsSnapshot {
  useEffect(() => {
    void loadSwarms();
  }, []);

  return useSyncExternalStore(subscribeSwarms, swarmsSnapshot, swarmsSnapshot);
}
