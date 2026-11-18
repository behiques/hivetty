import type { HostCommand, HostMessage } from '@shared/pty-host-protocol';

import type { HostPort } from './host';

/**
 * The slice of `process` the host's entry reads (HIVE-423). Narrow, so a test passes a fake and nothing here
 * imports Electron.
 */
export interface HostProcess {
  /** Present only inside a `utilityProcess` child. */
  parentPort?: HostPort;
  /**
   * Present only in a `child_process.fork` child. Always called with a callback: without one, a write that fails
   * is raised as `'error'` on `process`, which nothing handles, and the host would die before its teardown.
   */
  send?: (message: HostMessage, callback: (error: Error | null) => void) => unknown;
  connected?: boolean;
  on(event: 'message', listener: (message: HostCommand) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
}

/** The port this process was started with: `utilityProcess`'s, or one built over the fork channel. */
export function hostPort(proc: HostProcess): HostPort | null {
  if (proc.parentPort) return proc.parentPort;
  const send = proc.send;
  if (typeof send !== 'function') return null;

  let listener: ((event: { data: HostCommand }) => void) | undefined;
  let stopping = false;
  // The server is gone. Run the host's one shutdown path, once, so no session outlives it.
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    listener?.({ data: { type: 'shutdown' } });
  };

  return {
    postMessage(message) {
      // A send on a closed channel would raise 'error' on `process`: the server is gone, so nobody is owed this.
      if (!proc.connected) return;
      // A write can still fail (EPIPE) before the channel's close is seen. That is the server gone too.
      send.call(proc, message, (error) => {
        if (error) stop();
      });
    },
    on(_event, onMessage) {
      listener = onMessage;
      proc.on('message', (data) => {
        if (data.type === 'shutdown') stopping = true;
        onMessage({ data });
      });
      // The server died without saying so.
      proc.on('disconnect', stop);
    },
  };
}
