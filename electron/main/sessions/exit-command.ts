/**
 * What `/done` writes into the pty, as one write. See `closeFinished` in `./index.ts`.
 *
 * Its own module so the live suites type the production bytes (HIVE-360) without loading the
 * session layer.
 */
export const EXIT_COMMAND = '/exit\r';
