import { BrowserWindow } from 'electron';

import type { Broadcaster } from '../../../core/ipc/broadcaster';

/**
 * Today's fan-out, unchanged: every live window, skipping destroyed ones.
 *
 * Windows are resolved per send rather than captured, because the window is
 * created after `registerIpcHandlers` runs and on macOS it can be closed and
 * re-created while the app keeps running. That was true of the closure this
 * replaces and it is still the reason.
 */
export function createWindowBroadcaster(): Broadcaster {
  return {
    emit(channel, payload) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        /*
          The `never throws` in the interface above, actually implemented.

          Two ways `send` throws that the inline loops this replaces got away
          with: a payload that is not structured-cloneable, and a `webContents`
          torn down in the window between `isDestroyed()` answering and the send
          landing — a race no check can close, because the answer is stale the
          moment it is given.

          It matters more here than it did there. `ledger.onChange` calls this
          from inside `Ledger.append`'s own try/catch, where the rule is that
          neither delivery nor the notifier may fail the write that triggered
          them; and one dead surface must never cost the other surfaces their
          event. Caught per window rather than around the loop for that second
          reason.
        */
        try {
          window.webContents.send(channel, payload);
        } catch (cause) {
          console.error(`[hive] broadcast failed on ${channel}:`, cause);
        }
      }
    },
  };
}
