import { createPtyHost } from './host';
import { hostPort } from './port';
import { createSessionManager } from './session-manager';

/**
 * The pty-host process entry (story 091).
 *
 * Bundled as a second input of the `main` target, so it lands beside
 * `out/main/index.js` as `out/main/pty-host.js` and inherits the same module
 * format and the same Electron ABI the `node-pty` binary was rebuilt for
 * (story 084). Forking the *system* `node` instead would reintroduce exactly
 * the ABI mismatch that story exists to eliminate.
 *
 * Wiring only. Everything testable is in `host.ts`.
 */

/**
 * The port is `utilityProcess`'s `parentPort` on the desktop, or one built over
 * the `child_process.fork` channel under `hivetty-server` (HIVE-423).
 *
 * Reached through a narrow local type rather than by importing `electron`: the
 * host is a plain Node process that must not depend on Electron's module
 * graph, and the lint zone for this directory is what keeps that true. If
 * neither is present, this file is being run somewhere it was never meant to
 * be, and saying so beats a `TypeError` on an undefined property.
 */
const port = hostPort(process);

if (!port) {
  throw new Error(
    'pty-host must be started with utilityProcess.fork or child_process.fork: no parent port and no IPC channel',
  );
}

createPtyHost({ port, sessions: createSessionManager() });
