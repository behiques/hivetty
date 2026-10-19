/**
 * The app's one name (HIVE-242): what people read and what the app *is*.
 *
 * It used to be two (`Hive TTY` displayed over a `The Hive` identity). HiveTTY
 * runs beside The Hive as its own product, so the split has nothing left to
 * protect. Changing this is still not cosmetic:
 * - `app.setName` takes it, and `userData` is derived from it
 *   (`~/Library/Application Support/HiveTTY`): the window state, the hook
 *   settings, the session history, the generated plugin every session loads.
 * - Electron names the Keychain item `safeStorage` encrypts with after it, so the
 *   stored Jira and remote credentials are only readable under it.
 * - `productName` in `electron-builder.yml` matches it, and that names the bundle
 *   (`HiveTTY.app`), its executable and helper apps, and the dmg and zip the
 *   updater fetches.
 *
 * See "The app's name" in `docs/packaging-and-updates.md`.
 */
export const APP_NAME = 'HiveTTY';
