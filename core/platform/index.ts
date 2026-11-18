import type { NotificationDeliveryStatus } from '@shared/ipc-contract';
import type { ThisMachineAction } from '@shared/notification-contract';
import type { UpdateStatus } from '@shared/update-contract';

import type { Broadcaster } from '../ipc/broadcaster';
import type { RemoteReporter } from '../ipc/registry';
import type { HostChild } from '../pty-host/supervisor';

/**
 * The platform port (HIVE-422).
 *
 * Everything core needs from the shell it runs in, and nothing else. The
 * desktop builds one from Electron (`electron/main/platform.ts`); a server
 * builds one from plain Node. Core reads it through `platform()` at the call
 * sites that used to import `electron` or a shell file, so nothing under
 * `core/` imports either.
 */

/** Encrypt-at-rest for every credential file. Electron's safeStorage on the desktop; HIVE-424's backend on the server. */
export interface Secrets {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

/** What a handler reads from the event that carried a call. Electron's events satisfy it; so does a socket's reporter. */
export interface IpcEvent {
  senderFrame?: unknown;
  sender: RemoteReporter & { mainFrame?: unknown };
}

export interface IpcMainLike {
  on(channel: string, listener: (event: IpcEvent, payload: unknown) => void): unknown;
  handle(channel: string, handler: (event: IpcEvent, payload: unknown) => unknown): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): unknown;
}

export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** What the three native pickers pass to the open dialog. */
export interface OpenOptions {
  properties: ('openFile' | 'openDirectory' | 'multiSelections')[];
  filters?: { name: string; extensions: string[] }[];
}

/** An update notification the updater raises into the hub. */
export interface UpdateNotification {
  kind: 'app.update_available' | 'app.update_ready';
  id: string;
  title: string;
  body: string;
  action: { type: 'update.download' } | { type: 'update.install' } | { type: 'url'; url: string };
}

/**
 * Everything that needs a screen. A server has none, and every core call site
 * reads it as `platform().desktop?.…` with the answer a machine with no window
 * gives: nothing focused, no window, a cancelled dialog, nothing badged.
 */
export interface Desktop {
  ipcMain: IpcMainLike;
  broadcaster: Broadcaster;
  /** Is any live window of ours focused? */
  windowFocused(): boolean;
  /** Is any live window of ours open? */
  hasWindow(): boolean;
  /** A window got focus. Returns its own removal. */
  onWindowFocus(listener: () => void): () => void;
  /** A window lost focus. Returns its own removal. */
  onWindowBlur(listener: () => void): () => void;
  /** Seconds since the person last touched this machine. */
  idleSeconds(): number;
  /** The open dialog, parented on the sender's window. `null` for no window or a cancelled dialog. */
  pickPaths(sender: unknown, options: OpenOptions): Promise<string[] | null>;
  /** Select the file in a Finder window. */
  reveal(path: string): void;
  /** Hold off app suspension while `live`. */
  keepAwake(live: boolean): void;
  /** A wake, an unlock or a display coming back, settled. Returns its own removal. */
  onDisplayWake(listener: () => void, settleMs?: number): () => void;
  activateOnThisMachine(action: ThisMachineAction): void;
  focusThisMachine(): void;
  notificationDelivery(): NotificationDeliveryStatus;
  badgeDock(count: unknown): void;
  clearDockBadge(): void;
  checkForUpdatesInteractively(): Promise<void>;
  setUpdateNotificationSink(sink: (input: UpdateNotification) => void): void;
  updateStatus(): UpdateStatus;
}

export interface Platform {
  secrets: Secrets;
  paths: { stateDir: string; logsDir: string };
  /** The folder holding the shipped skills/, agents/ and shipped-history.json. */
  resources: string;
  /** Show one notification on this machine. */
  notify(toast: { title: string; body: string; onClick: () => void }): void;
  /** Fork the PTY host child. */
  processHost(): HostChild;
  mcpLaunch: McpLaunch;
  lifecycle: { version: string; isPackaged: boolean; quit(code?: number): void };
  desktop?: Desktop;
}

let current: Platform | null = null;

/** Called once by the shell, before any core code that reads the platform runs. */
export function setPlatform(next: Platform): void {
  current = next;
}

export function platform(): Platform {
  if (current === null) throw new Error('No platform is set. The shell calls setPlatform() before core runs.');
  return current;
}

/** Test-only. */
export function resetPlatform(): void {
  current = null;
}
