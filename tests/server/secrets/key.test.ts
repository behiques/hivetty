// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { generateKey, KEY_ENV, KEY_FILE_ENV, loadKey, NO_KEY, parseKey } from '../../../server/secrets/key';

const HEX = 'ab'.repeat(32);
const B64 = Buffer.alloc(32, 7).toString('base64');
const HOME = '/srv/hivetty';
const noFile = () => {
  throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
};
const messageOf = (result: ReturnType<typeof loadKey>): string => (result.ok ? '' : result.message);

describe('parseKey (HIVE-424)', () => {
  it('reads 64 hex characters and 44 base64 characters as 32 bytes', () => {
    expect(parseKey(HEX)).toEqual(Buffer.from(HEX, 'hex'));
    expect(parseKey(HEX.toUpperCase())).toEqual(Buffer.from(HEX, 'hex'));
    expect(parseKey(B64)).toEqual(Buffer.alloc(32, 7));
    expect(parseKey(`  ${B64}\n`)).toEqual(Buffer.alloc(32, 7));
  });

  it.each(['', 'short', HEX.slice(2), `${HEX}ab`, B64.slice(0, 43), `${B64}=`, B64.replace(/.$/, '-'), 'z'.repeat(64)])(
    'refuses %j',
    (text) => {
      expect(parseKey(text)).toBeNull();
    },
  );

  it('generates a key that parses back to 32 bytes, different each time', () => {
    expect(parseKey(generateKey())?.length).toBe(32);
    expect(generateKey()).not.toBe(generateKey());
  });
});

describe('loadKey (HIVE-424)', () => {
  it('reads the mounted file first, and still removes the variable from the environment', () => {
    const env: NodeJS.ProcessEnv = { [KEY_FILE_ENV]: '/run/secrets/key', [KEY_ENV]: B64 };
    const readFile = vi.fn(() => `${HEX}\n`);
    expect(loadKey(env, { readFile, homeDir: HOME })).toEqual({ ok: true, key: Buffer.from(HEX, 'hex') });
    expect(readFile).toHaveBeenCalledWith('/run/secrets/key');
    expect(KEY_ENV in env).toBe(false);
    expect(env[KEY_FILE_ENV]).toBe('/run/secrets/key');
  });

  it('reads the environment when no file is named, and removes it', () => {
    const env: NodeJS.ProcessEnv = { [KEY_ENV]: B64, [KEY_FILE_ENV]: '  ' };
    expect(loadKey(env, { readFile: noFile, homeDir: HOME })).toEqual({ ok: true, key: Buffer.alloc(32, 7) });
    expect(KEY_ENV in env).toBe(false);
  });

  it('with neither, refuses in one message naming both and --gen-key', () => {
    const result = loadKey({}, { readFile: noFile, homeDir: HOME });
    expect(result).toEqual({ ok: false, message: NO_KEY });
    expect(NO_KEY).toContain(KEY_FILE_ENV);
    expect(NO_KEY).toContain(`${KEY_ENV} `);
    expect(NO_KEY).toContain('--gen-key');
  });

  it('treats a blank variable as absent', () => {
    expect(loadKey({ [KEY_ENV]: ' ' }, { readFile: noFile, homeDir: HOME })).toEqual({ ok: false, message: NO_KEY });
  });

  it('an unreadable file refuses with the path and the code, and does not fall through to the environment', () => {
    const env: NodeJS.ProcessEnv = { [KEY_FILE_ENV]: '/run/secrets/key', [KEY_ENV]: B64 };
    const result = loadKey(env, { readFile: noFile, homeDir: HOME });
    expect(result.ok).toBe(false);
    expect(messageOf(result)).toContain('/run/secrets/key');
    expect(messageOf(result)).toContain('ENOENT');
    expect(KEY_ENV in env).toBe(false);
  });

  it('a file that holds no key refuses without echoing it, and does not fall through', () => {
    const env: NodeJS.ProcessEnv = { [KEY_FILE_ENV]: '/run/secrets/key', [KEY_ENV]: B64 };
    const result = loadKey(env, { readFile: () => 'hunter2-not-a-key', homeDir: HOME });
    expect(result.ok).toBe(false);
    expect(messageOf(result)).toContain(KEY_FILE_ENV);
    expect(messageOf(result)).not.toContain('hunter2');
    expect(KEY_ENV in env).toBe(false);
  });

  it('an environment value that is no key refuses without echoing it', () => {
    const env: NodeJS.ProcessEnv = { [KEY_ENV]: 'hunter2-not-a-key' };
    const result = loadKey(env, { readFile: noFile, homeDir: HOME });
    expect(result.ok).toBe(false);
    expect(messageOf(result)).toContain(KEY_ENV);
    expect(messageOf(result)).not.toContain('hunter2');
    expect(KEY_ENV in env).toBe(false);
  });

  it.each([`${HOME}/key`, `${HOME}/data/key`, `${HOME}/data/../key`])(
    'refuses a key file beside the data (%s) without reading it',
    (path) => {
      const readFile = vi.fn(() => HEX);
      const result = loadKey({ [KEY_FILE_ENV]: path }, { readFile, homeDir: HOME });
      expect(result.ok).toBe(false);
      expect(messageOf(result)).toContain('beside the data');
      expect(readFile).not.toHaveBeenCalled();
    },
  );

  it('accepts a file whose folder only starts with the home folder’s name', () => {
    const result = loadKey({ [KEY_FILE_ENV]: `${HOME}-keys/key` }, { readFile: () => HEX, homeDir: HOME });
    expect(result.ok).toBe(true);
  });
});
