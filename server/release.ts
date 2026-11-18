declare const __HIVETTY_RELEASE__: boolean;
declare const __HIVETTY_VERSION__: string;

/**
 * Fixed when the bundle is built (`server.vite.config.ts`), never read from the environment or a file at run time.
 *
 * Every developer escape hatch in the licence code turns off only when this is true: `HIVE_E2E` (the CLI plan lock),
 * `HIVETTY_LEASE_KEYS` (extra trusted signing keys) and `HIVETTY_CLOUD_URL`. A release that read this from the
 * environment could be pointed at a fake cloud signing with its own key, and run free.
 */
export const IS_RELEASE: boolean = __HIVETTY_RELEASE__;

/** The app's version, from package.json at build time. A prerelease (`-rc.1`) selects the dev cloud and its keys. */
export const VERSION: string = __HIVETTY_VERSION__;
