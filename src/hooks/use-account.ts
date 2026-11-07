import { useEffect, useState } from 'react';

import { onAccountChanged, readAccountState } from '@lib/account';
import type { AccountState } from '@shared/account-contract';

/**
 * The account (HIVE-264), for HIVE-265's gate, menu and pane. Subscribe first, then hydrate; local
 * state, as `useLicence` argues.
 */
export function useAccount(): AccountState | null {
  const [state, setState] = useState<AccountState | null>(null);
  useEffect(() => {
    let pushed = false;
    const unsubscribe = onAccountChanged((next) => {
      pushed = true;
      setState(next);
    });
    void readAccountState().then((read) => {
      if (!pushed && read !== null) setState(read);
    });
    return unsubscribe;
  }, []);
  return state;
}
