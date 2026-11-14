import type { PowerSaveBlocker } from 'electron';

/**
 * Hold the Mac awake while any agent run is live (HIVE-408), as `RunTracker`'s `onLive`.
 * Server mode's own blocker is separate.
 */
export function keepAwake(blocker: Pick<PowerSaveBlocker, 'start' | 'stop'>): (live: boolean) => void {
  let id: number | null = null;

  // shortcut: one blocker for every agent run, not per run; enough while runs are the only reason.
  return (live) => {
    if (live && id === null) id = blocker.start('prevent-app-suspension');
    else if (!live && id !== null) {
      blocker.stop(id);
      id = null;
    }
  };
}
