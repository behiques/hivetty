import { useEffect } from 'react';

import { onSwarmInstallRequested, takeSwarmInstallRequest } from '@lib/swarms';
import { useSetSwarmInstallRequest, useSettingsActions } from '@stores/ui-store';

/**
 * Take an install link's swarm (HIVE-442): once on mount, for a link that launched the app, and on every push
 * after. An id opens Settings › Swarms, where the pane resolves it; nothing here installs. Mounted once, in the shell.
 */
export function useSwarmInstallLink(): void {
  const setRequest = useSetSwarmInstallRequest();
  const { openSettings } = useSettingsActions();

  useEffect(() => {
    let live = true;
    const take = (): void => {
      void takeSwarmInstallRequest().then((swarmId) => {
        if (!live || swarmId === null) return;
        setRequest(swarmId);
        openSettings('swarms');
      });
    };
    const unsubscribe = onSwarmInstallRequested(take);
    take();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [setRequest, openSettings]);
}
