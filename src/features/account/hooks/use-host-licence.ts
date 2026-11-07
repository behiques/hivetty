import { useEffect, useState } from 'react';

import type { HostLicence } from '@shared/licence-contract';
import { useRemoteLink } from '@stores/hive-store';

/**
 * The server's licence, while this window is attached (HIVE-265). Read on attach and on every reattach (`epoch`),
 * then followed by its relayed push. Subscribe first, then read, as `useLicence` argues.
 */
export function useHostLicence(): HostLicence | null {
  const link = useRemoteLink();
  const attached = link?.state === 'attached';
  const epoch = link?.epoch ?? 0;
  const [host, setHost] = useState<HostLicence | null>(null);
  useEffect(() => {
    const bridge = window.hive;
    if (!attached || !bridge) return undefined;
    let live = true;
    let pushed = false;
    const unsubscribe = bridge.server.onLicence((next) => {
      pushed = true;
      setHost(next);
    });
    bridge.server.licence().then(
      (read) => {
        if (live && !pushed) setHost(read);
      },
      () => undefined,
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, [attached, epoch]);
  return attached ? host : null;
}
