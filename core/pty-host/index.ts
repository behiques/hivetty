import { platform } from '../platform';
import { onShutdown } from '../shutdown';

import {
  createPtyHostSupervisor,
  type PtyHostSupervisor,
} from './supervisor';

/**
 * Wiring the supervisor to the shell (story 091, HIVE-422).
 *
 * The fork itself is the platform's `processHost()`: `utilityProcess` on the
 * desktop. Nothing here imports `electron`, which is what keeps
 * `supervisor.ts` — the part with all the behaviour — drivable under Vitest.
 */

let supervisor: PtyHostSupervisor | null = null;

/**
 * Create the supervisor and register its teardown. **Forks nothing.**
 *
 * Called at startup, but the host itself starts lazily on the first spawn —
 * most launches land on the orchestrator console, which owns no PTY.
 */
export function registerPtyHost(): PtyHostSupervisor {
  if (supervisor) return supervisor;

  const created = createPtyHostSupervisor({ fork: () => platform().processHost() });

  /**
   * Registration, not a refactor of the quit path — which is exactly why
   * story 081 built `onShutdown` before anything needed it. `before-quit` is
   * already async-correct, so this hook is awaited rather than
   * fire-and-forget.
   */
  onShutdown(() => created.shutdown());

  supervisor = created;
  return created;
}

/** The live supervisor, or `null` before `registerPtyHost` has run. */
export function ptyHost(): PtyHostSupervisor | null {
  return supervisor;
}

/** Test-only: drop the singleton. */
export function resetPtyHost(): void {
  supervisor = null;
}

export type { HostChild, PtyHostSupervisor } from './supervisor';
