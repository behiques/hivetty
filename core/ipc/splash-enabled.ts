/**
 * Whether a launch should show the splash at all.
 *
 * There is deliberately no user-facing setting: no config key, no command-line
 * flag. The single exception is `HIVE_E2E`, which the Playwright suite already
 * sets to disable the simulation clock and animation-driven timing — the same
 * determinism lever, extended to the same kind of problem. Without it every one
 * of the suite's specs would wait out the floor and then have to work out which
 * of two windows is the app.
 *
 * The splash's own spec launches with it cleared, so the real path is still
 * driven end to end rather than merely unit-tested.
 */
export function splashEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.HIVE_E2E;
}
