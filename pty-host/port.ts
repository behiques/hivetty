import type { HostCommand, HostMessage } from '@shared/pty-host-protocol';

import type { HostPort } from './host';

/**
 * The slice of `process` the host's entry reads (HIVE-423). Narrow, so a test passes a fake and nothing here
 * imports Electron.
 */
export interface HostProcess {
  /** Present only inside a `utilityProcess` child. */
  parentPort?: HostPort;
  /** Present only in a `child_process.fork` child. */
  send?: (message: HostMessage) => unknown;
  connected?: boolean;
  on(event: 'message', listener: (message: HostCommand) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
}

/** The port this process was started with: `utilityProcess`'s, or one built over the fork channel. */
export function hostPort(proc: HostProcess): HostPort | null {
  if (proc.parentPort) return proc.parentPort;
  const send = proc.send;
  if (typeof send !== 'function') return null;

  return {
    postMessage(message) {
      // A send on a closed channel raises 'error' on `process`: the server is gone, so nobody is owed this.
      if (proc.connected) send.call(proc, message);
    },
    on(_event, listener) {
      let stopping = false;
      proc.on('message', (data) => {
        if (data.type === 'shutdown') stopping = true;
        listener({ data });
      });
      // The server died without saying so. Run the one shutdown path, so no session outlives it.
      proc.on('disconnect', () => {
        if (stopping) return;
        stopping = true;
        listener({ data: { type: 'shutdown' } });
      });
    },
  };
}
