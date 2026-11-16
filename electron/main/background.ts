import { app } from 'electron';

/**
 * Background launches: a test or script runs the app without taking focus.
 *
 * The electron e2e suite, `pnpm release:smoke` and the live suites that open
 * the app's window used to make HiveTTY the frontmost app on every launch
 * (macOS activates an app when one of its windows is `show()`n), so a person
 * typing elsewhere lost their keyboard to a test run. With `HIVE_BACKGROUND=1`
 * the app becomes an `accessory` (no Dock icon, never frontmost), every window
 * is revealed with `showInactive()`, and nothing calls `focus()`.
 *
 * An environment variable the launcher sets, deliberately: never a CLI flag a
 * person could pass by accident, never a config key. Without it every path is
 * exactly today's. `HIVE_E2E_FOREGROUND=1` in the e2e runner's environment
 * leaves it unset, for a person who wants to watch a run
 * (`tests/e2e/electron/fixtures/hive-app.ts`).
 */
export function isBackground(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HIVE_BACKGROUND === '1';
}

/** The slice of `BrowserWindow` the show paths touch, so tests pass a fake. */
interface Revealable {
  show(): void;
  showInactive(): void;
}

interface Focusable {
  focus(): void;
  showInactive(): void;
}

/** Reveal a window: `show()` as always, or `showInactive()` in the background. */
export function reveal(win: Revealable, env: NodeJS.ProcessEnv = process.env): void {
  if (isBackground(env)) win.showInactive();
  else win.show();
}

/**
 * Raise a window that already exists (second instance, tray, About, a
 * notification click). In the background it is made visible without focus.
 */
export function bringForward(win: Focusable, env: NodeJS.ProcessEnv = process.env): void {
  if (isBackground(env)) win.showInactive();
  else win.focus();
}

/**
 * On macOS, make a background run an accessory app before its first window.
 * Off macOS the policy does not exist and `showInactive()` is the whole job.
 */
export function applyBackgroundPolicy(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (platform !== 'darwin' || !isBackground(env)) return;
  app.setActivationPolicy('accessory');
}
