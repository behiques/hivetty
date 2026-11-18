import { releaseForQuit } from '../core/licence/suspend';
import { runShutdown } from '../core/shutdown';

/** HIVE-422: how long a SIGTERM waits for the shutdown hooks before the process exits anyway. */
export const SHUTDOWN_BUDGET_MS = 20_000;

/** The longest delay `setTimeout` honours; above it the timer fires after 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/** `HIVETTY_SHUTDOWN_BUDGET_MS` when it is a positive integer a timer can hold, else 20 s. */
export function budgetFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.HIVETTY_SHUTDOWN_BUDGET_MS?.trim() ?? '';
  if (!/^\d+$/.test(raw)) return SHUTDOWN_BUDGET_MS;
  const value = Number(raw);
  return value > 0 && value <= MAX_TIMER_MS ? value : SHUTDOWN_BUDGET_MS;
}

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * Continue anything a lapse stopped, then run the shutdown hooks, as the desktop's quit does. Resolves when they
 * finish or the budget runs out, whichever is first, and never rejects.
 */
export function shutDown(
  budgetMs: number,
  steps: { release(): Promise<void>; shutdown(): Promise<void> } = { release: releaseForQuit, shutdown: runShutdown },
): Promise<void> {
  const work = steps
    .release()
    .catch((cause: unknown) => console.error(`[hive] licence release on shutdown failed: ${message(cause)}`))
    .then(() => steps.shutdown())
    .catch((cause: unknown) => console.error(`[hive] shutdown failed: ${message(cause)}`));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.error(`[hive] shutdown took longer than ${String(budgetMs)} ms; exiting anyway`);
      resolve();
    }, budgetMs);
  });
  return Promise.race([work, budget]).finally(() => clearTimeout(timer));
}

/** The first SIGTERM or SIGINT quits cleanly; a second of either kind exits at once. */
export function installSignals(deps: {
  quit(code: number): void;
  exitNow(code: number): void;
  on?(signal: 'SIGTERM' | 'SIGINT', listener: () => void): void;
}): void {
  const on = deps.on ?? ((signal, listener) => void process.on(signal, listener));
  let received = false;
  const handle = (): void => {
    if (received) {
      deps.exitNow(1);
      return;
    }
    received = true;
    deps.quit(0);
  };
  on('SIGTERM', handle);
  on('SIGINT', handle);
}
