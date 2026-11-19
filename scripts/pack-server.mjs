#!/usr/bin/env node
/**
 * Pack `hivetty-server` for the Linux host this runs on (HIVE-425): `out/server/`, a pinned Node 26, node-pty's
 * runtime files and the resources, as `dist/server/hivetty-server-<version>-linux-<arch>.tar.gz` plus `SHA256SUMS`.
 * Linux only: `pty.node` is whatever this machine compiled. Run by `pnpm server:pack`, after `pnpm server:build`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The runtime inside the tarball. To bump: these three values, from that release's SHASUMS256.txt. */
export const NODE_VERSION = '26.13.1';
export const NODE_SHA256 = {
  arm64: '89e1853138db51e8b82d3e98ba9c0d3f2956a28e5e55ea1b7e12d25aae92d5dd',
  x64: '5c063e46bab0fbc1c17cc445d7ff129cbdcd0471be6ed83b6ab864f8143bc864',
};

export const tarballName = (version, arch) => `hivetty-server-${version}-linux-${arch}.tar.gz`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifySha256(bytes, expected) {
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
}

/** node-pty's runtime files, as paths inside its package: no tests, sources, maps or prebuilds. */
export function ptyRuntimeFiles(files) {
  return files.filter(
    (file) =>
      file === 'package.json' ||
      file === 'LICENSE' ||
      file === 'build/Release/pty.node' ||
      file === 'build/Release/spawn-helper' ||
      (file.startsWith('lib/') && file.endsWith('.js') && !file.endsWith('.test.js')),
  );
}

/** Every file under `dir`, relative to it. Symlinks are skipped: node-gyp leaves one to the Python it ran. */
function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    return stat.isDirectory() ? walk(path, base) : [relative(base, path)];
  });
}

function fail(message) {
  console.error(`server:pack: ${message}`);
  process.exit(1);
}

async function main() {
  if (process.platform !== 'linux') fail('packs the Linux host it runs on; run it in CI or a Linux container.');
  const arch = process.arch;
  const expected = NODE_SHA256[arch];
  if (!expected) fail(`no pinned Node for linux-${arch}.`);

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const built = join(root, 'out/server');
  if (!existsSync(join(built, 'index.js'))) fail('out/server/index.js is missing; run `pnpm server:build` first.');
  const pty = realpathSync(join(root, 'node_modules/node-pty'));
  if (!existsSync(join(pty, 'build/Release/pty.node'))) {
    fail('node-pty is not compiled here; run `pnpm rebuild node-pty`.');
  }

  const dist = join(root, 'dist/server');
  const stage = join(dist, 'hivetty-server');
  rmSync(dist, { recursive: true, force: true }); // a half-finished earlier run leaves nothing behind
  mkdirSync(join(stage, 'node'), { recursive: true });

  // Node: fetched, checked against the pin, and only then unpacked.
  const folder = `node-v${NODE_VERSION}-linux-${arch}`;
  const archive = join(dist, `${folder}.tar.xz`);
  const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${folder}.tar.xz`);
  if (!response.ok) fail(`nodejs.org answered ${String(response.status)} for ${folder}.tar.xz.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifySha256(bytes, expected);
  writeFileSync(archive, bytes);
  execFileSync('tar', ['-xJf', archive, '-C', join(stage, 'node'), '--strip-components=1', `${folder}/bin/node`, `${folder}/LICENSE`]);
  rmSync(archive);

  cpSync(built, join(stage, 'app/server'), { recursive: true });
  for (const file of ptyRuntimeFiles(walk(pty))) {
    const to = join(stage, 'app/node_modules/node-pty', file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(pty, file), to);
  }
  // node-pty builds spawn-helper on macOS only (its binding.gyp; Linux's pty.cc never calls it), so a Linux pack has
  // none. Where one exists it may be 0644, and a 0644 helper fails every spawn.
  const helper = join(stage, 'app/node_modules/node-pty/build/Release/spawn-helper');
  if (existsSync(helper)) chmodSync(helper, 0o755);

  for (const name of ['skills', 'agents', 'shipped-history.json']) {
    cpSync(join(root, 'resources', name), join(stage, 'resources', name), { recursive: true });
  }
  mkdirSync(join(stage, 'bin'));
  cpSync(join(root, 'server/bin/hivetty-server'), join(stage, 'bin/hivetty-server'));
  chmodSync(join(stage, 'bin/hivetty-server'), 0o755);
  for (const name of ['LICENSE', 'NOTICE']) cpSync(join(root, name), join(stage, name));
  writeFileSync(join(stage, 'VERSION'), `${version}\n`);

  const name = tarballName(version, arch);
  execFileSync('tar', ['-czf', join(dist, name), '--owner=0', '--group=0', '--numeric-owner', '-C', dist, 'hivetty-server']);
  rmSync(stage, { recursive: true });
  // Last, so a SHA256SUMS on disk always names a finished tarball.
  writeFileSync(join(dist, 'SHA256SUMS'), `${sha256(readFileSync(join(dist, name)))}  ${name}\n`);
  console.log(`packed dist/server/${name}`);
}

// Node realpaths the main module's URL but not argv[1], so a symlinked path compares real to real.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((cause) => fail(cause instanceof Error ? cause.message : String(cause)));
}
