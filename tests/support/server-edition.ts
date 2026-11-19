import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * How the live suites run the server edition (HIVE-422, HIVE-427): `node out/server/index.js` under
 * `HIVE_SERVER_NODE` (else this process's own Node), or an unpacked tarball's wrapper named by `HIVE_SERVER_BIN`.
 * Shared by `tests/live/server-edition-conformance.test.ts` and the edition side of
 * `tests/live/server-conformance.test.ts`.
 */
const ROOT = join(import.meta.dirname, '../..');

/** The Node that runs `out/server/index.js`: `HIVE_SERVER_NODE`, else this process's own. */
export const SERVER_NODE = process.env['HIVE_SERVER_NODE'] ?? process.execPath;
/** An unpacked tarball's `bin/hivetty-server` (HIVE-425); its tree is the folder above `bin/`. */
export const SERVER_BIN = process.env['HIVE_SERVER_BIN'] || undefined;
/** The repo's built server entry, from `pnpm server:build`. */
export const SERVER_ENTRY = join(ROOT, 'out/server/index.js');
/** The built server under test: the repo's `out/server`, or the tarball's `app/server`. */
export const SERVER_OUT = SERVER_BIN === undefined ? join(ROOT, 'out/server') : join(SERVER_BIN, '../..', 'app/server');

/** What to spawn for `args`: the tarball's wrapper when `HIVE_SERVER_BIN` is set, else `SERVER_NODE entry`. */
export function serverCommand(args: string[], entry = SERVER_ENTRY): [file: string, argv: string[]] {
  return SERVER_BIN === undefined ? [SERVER_NODE, [entry, ...args]] : [SERVER_BIN, args];
}

/**
 * A secret key file (`HIVETTY_SECRET_KEY_FILE`) in a fresh folder under the OS temp dir, mode 0600: a key inside
 * the home exits 4 (HIVE-424). The caller removes `dir`.
 */
export function writeKeyFile(key = randomBytes(32).toString('base64')): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'hive-server-key-'));
  const file = join(dir, 'key');
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return { dir, file };
}
