import { randomBytes } from 'node:crypto';
import { resolve, sep } from 'node:path';

export const KEY_FILE_ENV = 'HIVETTY_SECRET_KEY_FILE';
export const KEY_ENV = 'HIVETTY_SECRET_KEY';
/** Its own code: 3 is already the edition refusal, and the account command's `storage`. */
export const KEY_EXIT = 4;

const KEY_SHAPE = 'A key is 32 random bytes, as 64 hex or 44 base64 characters; `hivetty-server --gen-key` prints one.';
export const NO_KEY =
  `hivetty-server needs a secret key and found none. Set ${KEY_FILE_ENV} to a file that holds the key, or ` +
  `${KEY_ENV} to the key itself. \`hivetty-server --gen-key\` prints a fresh one. Nothing is ever stored unencrypted.`;

export type KeyResult = { ok: true; key: Buffer } | { ok: false; message: string };

const blank = (value: string | undefined): value is undefined => value === undefined || value.trim() === '';
const refuse = (message: string): KeyResult => ({ ok: false, message });

/** 64 hex or 44 base64 characters, nothing else. Node's base64 decoder forgives anything, so the pattern is the check. */
export function parseKey(text: string): Buffer | null {
  const value = text.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) return Buffer.from(value, 'base64');
  return null;
}

/**
 * The server's key (HIVE-424), from the first source present: a mounted file, then the environment. A source that
 * is present and unusable refuses; it never falls through to the next, which could be a different key.
 */
export function loadKey(env: NodeJS.ProcessEnv, deps: { readFile(path: string): string; homeDir: string }): KeyResult {
  const fromEnv = env[KEY_ENV];
  /*
    Gone before anything is spawned, so no child inherits it. That is all this buys: on Linux /proc/<pid>/environ
    keeps the environment the process started with, readable by any process under the same uid. A runner is safe
    because agents run under another uid (HIVE-423); in local development, where they share it, use the key file.
  */
  delete env[KEY_ENV];

  const file = env[KEY_FILE_ENV];
  if (!blank(file)) {
    const path = resolve(file);
    // shortcut: compares resolved paths and does not chase symlinks, upgrade to realpath if a link ever defeats it.
    if (path.startsWith(resolve(deps.homeDir) + sep)) {
      return refuse(
        `${KEY_FILE_ENV} (${path}) is inside the HiveTTY home folder. The key must not sit beside the data it protects; keep it somewhere else.`,
      );
    }
    let text: string;
    try {
      text = deps.readFile(path);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code ?? 'unreadable';
      return refuse(`cannot read ${KEY_FILE_ENV} (${path}): ${code}.`);
    }
    const key = parseKey(text);
    return key === null ? refuse(`${KEY_FILE_ENV} (${path}) does not hold a key. ${KEY_SHAPE}`) : { ok: true, key };
  }
  if (!blank(fromEnv)) {
    const key = parseKey(fromEnv);
    return key === null ? refuse(`${KEY_ENV} is not a key. ${KEY_SHAPE}`) : { ok: true, key };
  }
  return refuse(NO_KEY);
}

export const generateKey = (): string => randomBytes(32).toString('base64');
