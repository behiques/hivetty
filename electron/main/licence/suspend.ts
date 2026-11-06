import { execFile } from 'node:child_process';

import type { LicenceState } from '@shared/licence-contract';

/**
 * Suspend on a licence lapse, resume on its return (HIVE-267): every process stops in place and continues
 * exactly where it was. Nothing is killed, and no write is cut off. Known trade-off: a CLI paused mid-request
 * may time out when it resumes, and retry or fail on its own.
 */
export const RESUME_NOTICE = 'Resumed after licence renewal.';
export const CONTAINER_TIMEOUT_MS = 10_000;

export interface SuspenderDeps {
  ptyHost: { suspendAll(): void; resumeAll(notice?: string): void };
  runs: { signalAll(signal: 'SIGSTOP' | 'SIGCONT'): void; containers(): { runtime: string; name: string }[] };
  /** `<runtime> pause|unpause <name>`; resolves either way, logging a failure. */
  container: (runtime: string, verb: 'pause' | 'unpause', name: string) => Promise<void>;
}

export interface Suspender {
  /** Feed every licence state here; entering `lapsed` suspends, leaving it resumes. `unlicensed` never suspends (D4). */
  onState(state: LicenceState): Promise<void>;
  lapsed(): boolean;
  /** Before quit: continue everything, without a notice. */
  releaseForQuit(): Promise<void>;
}

export function createSuspender(deps: SuspenderDeps): Suspender {
  let suspended = false;
  /** Set by `releaseForQuit`, for good: nothing is stopped again on the way out. */
  let released = false;
  let paused: { runtime: string; name: string }[] = [];
  let chain: Promise<void> = Promise.resolve();

  const settle = (work: Promise<void>[]): Promise<void> => Promise.allSettled(work).then(() => undefined);

  /** One step's failure is logged and never skips the next: a half-done resume leaves work stopped. */
  const step = (what: string, work: () => void): void => {
    try {
      work();
    } catch (error) {
      console.info(`[hive] licence ${what} failed (${error instanceof Error ? error.message : String(error)})`);
    }
  };

  async function suspend(): Promise<void> {
    // Before the first await: a spawn arriving mid-suspend is already refused.
    suspended = true;
    /*
      shortcut: only container *runs* are paused (D3). An interactive container session names its container
      only inside the user's free-form `claudeCommand`, so there is no name to pause: the PTY walk stops its
      `docker exec` client, and the agent inside blocks once nothing reads its output. A session sharing a
      container with a live run is paused along with it. Upgrade: give sessions a structured container name.
    */
    paused = deps.runs.containers();
    await settle(paused.map((c) => deps.container(c.runtime, 'pause', c.name)));
    // Quit released while the pause was pending: stop nothing it would have to continue.
    if (released) return;
    step('suspend of the pty-host', () => deps.ptyHost.suspendAll());
    step('SIGSTOP of the runs', () => deps.runs.signalAll('SIGSTOP'));
  }

  async function resume(notice?: string): Promise<void> {
    try {
      step('resume of the pty-host', () => deps.ptyHost.resumeAll(notice));
      step('SIGCONT of the runs', () => deps.runs.signalAll('SIGCONT'));
      const toUnpause = paused;
      paused = [];
      await settle(toUnpause.map((c) => deps.container(c.runtime, 'unpause', c.name)));
    } finally {
      suspended = false;
    }
  }

  /**
   * One transition at a time, so a fast lapse-then-renew never interleaves. A failed one neither wedges the next
   * nor rejects: callers `void` these.
   */
  const queue = (work: () => Promise<void>): Promise<void> =>
    (chain = chain.then(work).catch((error: unknown) => {
      console.info(`[hive] licence transition failed (${error instanceof Error ? error.message : String(error)})`);
    }));

  return {
    lapsed: () => suspended,
    onState(state) {
      return queue(async () => {
        if (released) return;
        if (state.kind === 'lapsed' && !suspended) await suspend();
        else if (state.kind !== 'lapsed' && suspended) await resume(RESUME_NOTICE);
      });
    },
    releaseForQuit() {
      released = true;
      return queue(async () => {
        if (suspended) await resume();
      });
    },
  };
}

let installed: Suspender | null = null;

/** Module-level, like `licence()`: the one instance `ipc/index.ts` installs. */
export function installSuspender(suspender: Suspender | null): void {
  installed = suspender;
}

/** The gate every refusal reads (injected into runs, the scheduler and sessions). */
export function isLapsed(): boolean {
  return installed?.lapsed() ?? false;
}

export function releaseForQuit(): Promise<void> {
  return installed?.releaseForQuit() ?? Promise.resolve();
}

/** `<runtime> pause|unpause <name>`, capped at {@link CONTAINER_TIMEOUT_MS}. Resolves either way, logging a failure. */
export function runContainer(runtime: string, verb: 'pause' | 'unpause', name: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(runtime, [verb, name], { timeout: CONTAINER_TIMEOUT_MS }, (error) => {
      if (error) console.info(`[hive] ${runtime} ${verb} ${name} failed (${error.message})`);
      resolve();
    });
  });
}
