import { useEffect } from 'react';

import { onApplyAppearance, reportAppearance } from '@lib/sync';
import { syncedAppearance, useAppearanceStore } from '@stores/appearance-store';

/**
 * Mounted once per window (HIVE-284): reports the appearance fields settings sync carries to main, on mount and
 * whenever one of them changes, and applies the ones main sends. A panel width or any other field reports
 * nothing. Applying what main sent reports exactly what main holds, so the engine finds nothing to send.
 */
export function useAppearanceSync(): void {
  useEffect(() => {
    let last = JSON.stringify(syncedAppearance(useAppearanceStore.getState()));
    void reportAppearance(JSON.parse(last) as ReturnType<typeof syncedAppearance>);
    const stopStore = useAppearanceStore.subscribe((state) => {
      const picked = syncedAppearance(state);
      const text = JSON.stringify(picked);
      if (text === last) return;
      last = text;
      void reportAppearance(picked);
    });
    const stopApply = onApplyAppearance((fields) => useAppearanceStore.getState().applySynced(fields));
    return () => {
      stopStore();
      stopApply();
    };
  }, []);
}
