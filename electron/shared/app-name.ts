/**
 * The app's one name (HIVE-242): what people read and what the app *is*.
 *
 * It used to be two (`Hive TTY` displayed over a `The Hive` identity). It is
 * `HiveTTY Pro` (HIVE-350) because the public app takes `HiveTTY` (HIVE-326),
 * and the two must install side by side. Changing this is still not cosmetic:
 * - `app.setName` takes it, and `userData` is derived from it
 *   (`~/Library/Application Support/HiveTTY Pro`): the window state, the hook
 *   settings, the session history, the generated plugin every session loads.
 * - Electron names the Keychain item `safeStorage` encrypts with after it, so the
 *   stored Jira and remote credentials are only readable under it.
 * - `productName` in `electron-builder.yml` matches it, and that names the bundle
 *   (`HiveTTY Pro.app`), its executable and its helper apps.
 *
 * See "The app's name" in `docs/packaging-and-updates.md`.
 */
export const APP_NAME = 'HiveTTY Pro';

/**
 * The unpackaged build's `userData` folder name. Not `hivetty pro`: APFS is
 * case-insensitive, so that is the packaged `HiveTTY Pro` folder and a dev run
 * would share its single-instance lock and state. Not `hivetty-dev` either, the
 * public app's (HIVE-350).
 */
export const DEV_USER_DATA_NAME = 'hivetty-pro-dev';
