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

/** Everything that needs a screen. A server has none. */
export interface Desktop {
  ipcMain: IpcMainLike;
  broadcaster: Broadcaster;
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
