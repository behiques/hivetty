import { useCallback, useEffect, useState } from 'react';

import { openAccountWeb } from '@lib/account';
import { watchPurchase } from '@lib/licence';
import { UPGRADE_PATH } from '@shared/entitlement';

/**
 * Choose a plan (HIVE-265): the plan page in the browser, signed in, while main renews every 5 s for 15 min. A
 * lease arriving opens the gate by itself. Cancel and unmount stop the watch.
 */
export function useChoosePlan(): { waiting: boolean; error: string | null; start: () => void; cancel: () => void } {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback(() => {
    setError(null);
    void openAccountWeb(UPGRADE_PATH).then((result) => {
      if (result && 'error' in result) {
        setError(result.error);
        return;
      }
      setWaiting(true);
      void watchPurchase(true);
    });
  }, []);
  const cancel = useCallback(() => {
    setWaiting(false);
    void watchPurchase(false);
  }, []);
  useEffect(() => () => void watchPurchase(false), []);
  return { waiting, error, start, cancel };
}
