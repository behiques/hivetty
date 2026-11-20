import { join } from 'node:path';

import {
  BrowserWindow,
  Notification,
  app,
  dialog,
  ipcMain,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  shell,
  utilityProcess,
} from 'electron';

import type { Platform } from '../../core/platform';
import type { HostChild } from '../../core/pty-host/supervisor';

import { onDisplayWake } from './display-wake';
import { remoteCredentialStore } from './ipc/remote-credential';
import { applyRemoteForget, applyRemotePair } from './ipc/remote-pairing';
import { createWindowBroadcaster } from './ipc/window-broadcaster';
import { keepAwake } from './keep-awake';
import { activateOnThisMachine, focusThisMachine } from './notifications/activate-here';
import { notificationDelivery, recordNotificationRefusal } from './notifications/delivery';
import { badgeDock, clearDockBadge } from './notifications/dock-badge';
import { checkForUpdatesInteractively, setUpdateNotificationSink, updateStatus } from './updates';

/**
 * The desktop's platform (HIVE-422): core's port, built from Electron.
 *
 * **Every Electron export is read lazily**, inside a getter or a function. The
 * unit suites mock `electron` with only the exports each one needs, and reading
 * a missing export at construction would throw in all of them. Building this
 * object touches nothing.
 */
export function createDesktopPlatform(): Platform {
  /** One blocker for every agent run (HIVE-408), built on first use: the suites' mocks have no `powerSaveBlocker`. */
  let runAwake: ((live: boolean) => void) | undefined;

  return {
    get secrets() {
      return safeStorage;
    },
    paths: {
      get stateDir() {
        return app.getPath('userData');
      },
      get logsDir() {
        return app.getPath('logs');
      },
    },
    notify: ({ title, body, onClick }) => {
      // False on a Linux box with no notification daemon. Checked per send
      // rather than once at boot: the daemon can arrive or go away while the
      // app is running, and constructing one when unsupported throws.
      if (!Notification.isSupported()) return;

      const notification = new Notification({ title, body });
      notification.on('click', onClick);
      /**
       * The failure that was being thrown away.
       *
       * `show()` is fire-and-forget and its refusal arrives here, on an event
       * nothing was listening to. Measured on macOS 15 / Electron 43.2.0:
       * `isSupported()` returns `true`, this event fires with `UNErrorDomain
       * error 1` — not authorized — and the app carried on reporting desktop
       * delivery as available. Every "System" notification since has been
       * dropped in silence.
       *
       * Recorded rather than merely logged, because the honest place for it is
       * the settings pane that offers the switch. Logged once per distinct
       * reason so a fleet of blocked sessions cannot fill a terminal with the
       * same line.
       */
      notification.on('failed', (_event, error) => {
        const reason = String(error);
        if (!recordNotificationRefusal(reason)) return;
        console.error(
          `[hive] the OS refused a desktop notification — the inbox still has it (${reason})`,
        );
      });
      notification.show();

      /**
       * The dock is what still works when the OS says no.
       *
       * Measured on the same machine that refuses notifications outright:
       * `app.dock.bounce('critical')` and `setBadge` both succeed, because
       * neither needs notification authorization. So the app is not out of ways
       * to reach someone in another window — it was only using the one that was
       * being rejected.
       *
       * Unconditional rather than only on a recorded refusal. A bounce is what
       * `both` already means — *interrupt me* — and gating it on a failure
       * would make the first interruption of every launch the one that gets
       * lost, since the refusal is not known until a send has already failed.
       * `dock` is undefined off macOS, where the badge and bounce have no
       * equivalent and the toast is expected to work.
       *
       * **`informational`, not `critical`.** `critical` maps to
       * `NSCriticalRequest`, which bounces *until the app is activated* — and
       * nothing here ever calls `cancelBounce`. A fleet left overnight would
       * start bouncing at the first session to go quiet and not stop until
       * somebody came back to it, which is not an interruption, it is a fault
       * light. `informational` bounces once, which is the whole of what a
       * notification is entitled to; the **badge** is the part that persists,
       * and it persists honestly because it is a count rather than an alarm.
       */
      app.dock?.bounce('informational');
    },
    /**
     * `utilityProcess`, not `child_process.fork`.
     *
     * Three things Electron's own API brings that `fork` does not:
     *
     * - The child is an **Electron** Node process, so it has the same ABI the
     *   `node-pty` binary was built for (story 084).
     * - MessagePort-based messaging, structured-clone typed, rather than a
     *   hand-rolled stdio protocol.
     * - Electron tracks the child's lifetime with the app, so a hard quit cannot
     *   orphan it.
     *
     * `pty-host.js` is emitted beside `index.js` by the `main` target's second
     * rollup input.
     */
    processHost: (): HostChild =>
      utilityProcess.fork(join(import.meta.dirname, 'pty-host.js'), [], {
        // Names the process in Activity Monitor. A nameless helper next to an app
        // that spawns terminals is the one a user force-quits first.
        serviceName: 'hive-pty-host',
      }),
    /**
     * The app's own binary, `process.execPath`, run as Node.
     *
     * Not a system `node`, and not optional. The host is loaded out of
     * `app.asar` in a packaged build, and only Electron's patched `fs` can read
     * it; a plain `node` would fail to resolve the script at all.
     * `import.meta.dirname` is `out/main/` in both dev and a packaged build.
     */
    mcpLaunch: {
      command: process.execPath,
      args: [join(import.meta.dirname, 'mcp-host.js')],
      /*
        Without this the Electron binary boots Chromium and opens a window
        instead of running the script. Verified against the real CLI: an `env`
        block in this file does reach the server process.
      */
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
    lifecycle: {
      get version() {
        return app.getVersion();
      },
      get isPackaged() {
        return app.isPackaged;
      },
      quit: () => {
        app.quit();
      },
    },
    desktop: {
      get ipcMain() {
        return ipcMain;
      },
      broadcaster: createWindowBroadcaster(),
      /**
       * Any window of ours, not only the main one: the About panel or the
       * splash being focused is still the user looking at the app.
       */
      windowFocused: () =>
        BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused()),
      hasWindow: () => BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
      onWindowFocus: (listener) => {
        app.on('browser-window-focus', listener);
        return () => {
          app.removeListener('browser-window-focus', listener);
        };
      },
      onWindowBlur: (listener) => {
        app.on('browser-window-blur', listener);
        return () => {
          app.removeListener('browser-window-blur', listener);
        };
      },
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      pickPaths: async (sender, options) => {
        /*
          The parent window is resolved from the sender rather than captured: on
          macOS the window can be closed and re-created while the app keeps
          running. Destroyed between the invoke and here is a cancelled dialog,
          which every caller already handles.
        */
        const window = BrowserWindow.fromWebContents(sender as Electron.WebContents);
        if (!window) return null;
        const result = await dialog.showOpenDialog(window, options);
        return result.canceled ? null : result.filePaths;
      },
      reveal: (path) => {
        shell.showItemInFolder(path);
      },
      keepAwake: (live) => {
        (runAwake ??= keepAwake(powerSaveBlocker))(live);
      },
      onDisplayWake: (listener, settleMs) => onDisplayWake(listener, settleMs),
      activateOnThisMachine,
      focusThisMachine,
      notificationDelivery,
      badgeDock,
      clearDockBadge,
      checkForUpdatesInteractively,
      setUpdateNotificationSink,
      updateStatus,
      /*
        A store per call, as `router.ts` already builds them: `createTokenStore`
        holds nothing between calls, so a pair followed by a read sees the write.
      */
      remotePairing: {
        paired: () => remoteCredentialStore().read() !== null,
        pair: (payload) => applyRemotePair(payload, remoteCredentialStore()),
        forget: () => {
          applyRemoteForget(remoteCredentialStore());
        },
      },
    },
  };
}
