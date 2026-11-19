// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `server/bin/hivetty-server` (HIVE-425): the tarball's entry point. It finds its own tree through any symlink and
 * `exec`s the Node beside it on `app/server/index.js`, arguments unchanged. The fake Node prints its argv and exits 7.
 */
const WRAPPER = join(import.meta.dirname, '../../../server/bin/hivetty-server');

let root = '';

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'hive-server-bin-')));
  const tree = join(root, 'tree');
  mkdirSync(join(tree, 'bin'), { recursive: true });
  mkdirSync(join(tree, 'node/bin'), { recursive: true });
  mkdirSync(join(tree, 'app/server'), { recursive: true });
  copyFileSync(WRAPPER, join(tree, 'bin/hivetty-server'));
  chmodSync(join(tree, 'bin/hivetty-server'), 0o755);
  writeFileSync(join(tree, 'node/bin/node'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done\nexit 7\n', {
    mode: 0o755,
  });
  mkdirSync(join(root, 'elsewhere'));
  symlinkSync(join(tree, 'bin/hivetty-server'), join(root, 'elsewhere/hs'));
  symlinkSync(join(tree, 'bin'), join(root, 'linkbin'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(file: string, cwd?: string): { lines: string[]; status: number | null } {
  const result = spawnSync(file, ['--pair', 'a b'], { encoding: 'utf8', cwd });
  return { lines: result.stdout.split('\n').filter((line) => line !== ''), status: result.status };
}

describe('server/bin/hivetty-server', () => {
  it('runs the Node beside it on app/server/index.js, arguments unchanged, with its exit code', () => {
    expect(run(join(root, 'tree/bin/hivetty-server'))).toEqual({
      lines: [join(root, 'tree/app/server/index.js'), '--pair', 'a b'],
      status: 7,
    });
  });

  it('finds its tree when called through a symlink to the file, from another folder', () => {
    expect(run(join(root, 'elsewhere/hs'), '/')).toEqual({
      lines: [join(root, 'tree/app/server/index.js'), '--pair', 'a b'],
      status: 7,
    });
  });

  it('finds its tree when called through a symlink to its bin folder', () => {
    expect(run(join(root, 'linkbin/hivetty-server'))).toEqual({
      lines: [join(root, 'tree/app/server/index.js'), '--pair', 'a b'],
      status: 7,
    });
  });
});
