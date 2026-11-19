import { fork as nodeFork } from 'node:child_process';

import type { HostChild } from '../core/pty-host';

/** The user the host, and so every PTY, runs as. Set by a runner (HIVE-300); a personal server leaves it out. */
export interface HostUser {
  uid: number;
  gid: number;
}

/**
 * The server's PTY host (HIVE-423): the desktop forks a `utilityProcess`, plain Node forks this. The child speaks
 * the same protocol, so the supervisor cannot tell them apart.
 */
export function forkPtyHost(input: {
  /** The built `pty-host.js`. */
  entry: string;
  user?: HostUser | undefined;
  /** Injected so a unit test forks nothing. */
  fork?: typeof nodeFork;
}): HostChild {
  // Throws synchronously: the supervisor fails that one spawn and forks again on the next.
  const child = (input.fork ?? nodeFork)(input.entry, [], {
    // Structured clone, as the desktop host's MessagePort gives.
    serialization: 'advanced',
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    ...(input.user ? { uid: input.user.uid, gid: input.user.gid } : {}),
  });

  const exitListeners: ((code: number) => void)[] = [];
  let spawned = false;
  let exited = false;
  const exit = (code: number): void => {
    if (exited) return;
    exited = true;
    for (const listener of exitListeners) listener(code);
  };

  child.once('spawn', () => {
    spawned = true;
  });
  child.on('exit', (code) => exit(code ?? 1));
  // Always listened for: an unhandled 'error' ends the server. Before 'spawn' the host never started, and
  // 'exit' may never follow, so this is the exit.
  child.on('error', (error) => {
    console.error(`[pty-host] ${error.message}`);
    if (!spawned) exit(1);
  });

  const on = ((event: 'message' | 'exit' | 'spawn', listener: (...args: never[]) => void): void => {
    if (event === 'exit') exitListeners.push(listener as (code: number) => void);
    else child.on(event, listener as (...args: unknown[]) => void);
  }) as HostChild['on'];

  return {
    get pid() {
      return child.pid;
    },
    postMessage(message) {
      // A host that is gone is dropped to, as utilityProcess drops; it never throws into an IPC handler.
      if (child.connected) child.send(message);
    },
    kill: () => child.kill(),
    on,
  };
}
