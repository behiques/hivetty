import { useEffect, useState } from 'react';

import { onRelayStatusChanged, readRelayStatus } from '@/lib/relay';

import type { RelayServeStatus } from '@shared/relay-contract';


/**
 * This machine's managed-relay serving state (HIVE-429), for Settings › Server mode. Reads once and follows the
 * push; a push that lands before the read wins, as `useLicenceRead` does. Local state: it changes rarely and
 * only one pane shows it.
 */
export function useRelayStatus(): RelayServeStatus {
  const [status, setStatus] = useState<RelayServeStatus>({ state: 'off' });
  useEffect(() => {
    let pushed = false;
    let live = true;
    const unsubscribe = onRelayStatusChanged((next) => {
      pushed = true;
      setStatus(next);
    });
    void readRelayStatus().then((read) => {
      if (live && !pushed) setStatus(read);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return status;
}
