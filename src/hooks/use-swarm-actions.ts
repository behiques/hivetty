import { useCallback, useMemo } from 'react';

import { signIn } from '@lib/account';
import { useSetSwarmInstallRequest, useSetSwarmsBrowseRequest, useSettingsActions } from '@stores/ui-store';

/**
 * The two things a missing-swarm notice offers (HIVE-447). `install(id)` hands the id to Settings › Swarms, which
 * opens the consent dialog (or asks for sign-in first); with no id there is no registry row to name, so it signs
 * in. `browse()` opens the pane on Browse. Neither installs anything.
 */
export function useSwarmActions(): { install: (swarmId: string | null) => void; browse: () => void } {
  const setInstallRequest = useSetSwarmInstallRequest();
  const setBrowseRequest = useSetSwarmsBrowseRequest();
  const { openSettings } = useSettingsActions();

  const install = useCallback(
    (swarmId: string | null): void => {
      if (swarmId === null) {
        void signIn();
        return;
      }
      setInstallRequest(swarmId);
      openSettings('swarms');
    },
    [setInstallRequest, openSettings],
  );

  const browse = useCallback((): void => {
    setBrowseRequest(true);
    openSettings('swarms');
  }, [setBrowseRequest, openSettings]);

  return useMemo(() => ({ install, browse }), [install, browse]);
}
