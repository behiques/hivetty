import { useEffect, useState } from 'react';

/**
 * Is the licence gate off (HIVE-265 ruling 4)? With no bridge (the browser target and its e2e) it is, at once.
 * In the app, main says so only for an unpackaged run under HIVE_E2E (`AppInfo.gateOff`). `null` while asking.
 */
export function useGateOff(): boolean | null {
  const [off, setOff] = useState<boolean | null>(() => (window.hive ? null : true));
  useEffect(() => {
    const bridge = window.hive;
    if (!bridge) return undefined;
    let live = true;
    bridge.appInfo().then(
      (info) => {
        if (live) setOff(info.gateOff === true);
      },
      () => {
        if (live) setOff(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return off;
}
