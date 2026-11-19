// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { NODE_SHA256, NODE_VERSION, ptyRuntimeFiles, tarballName, verifySha256 } from '../../scripts/pack-server.mjs';

/** The pure half of `pnpm server:pack` (HIVE-425). The pack itself runs on Linux, in CI and the Docker dry run. */
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('pack-server', () => {
  it('names the tarball for the version and the architecture', () => {
    expect(tarballName('1.0.0-rc.12', 'arm64')).toBe('hivetty-server-1.0.0-rc.12-linux-arm64.tar.gz');
  });

  it('accepts bytes whose SHA-256 is the pinned one and refuses any other', () => {
    expect(() => verifySha256(Buffer.from('abc'), ABC)).not.toThrow();
    expect(() => verifySha256(Buffer.from('abc'), `${ABC.slice(0, -1)}e`)).toThrow(/checksum mismatch/);
    expect(() => verifySha256(Buffer.alloc(0), ABC)).toThrow(/checksum mismatch/);
  });

  it('pins a Node 26 and a distinct SHA-256 for each architecture', () => {
    expect(NODE_VERSION).toMatch(/^26\.\d+\.\d+$/);
    expect(NODE_SHA256.arm64).toMatch(/^[0-9a-f]{64}$/);
    expect(NODE_SHA256.x64).toMatch(/^[0-9a-f]{64}$/);
    expect(NODE_SHA256.arm64).not.toBe(NODE_SHA256.x64);
  });

  it("keeps node-pty's runtime files only: no sources, tests, maps, objects or prebuilds", () => {
    expect(
      ptyRuntimeFiles([
        'package.json',
        'LICENSE',
        'README.md',
        'binding.gyp',
        'src/unix/pty.cc',
        'lib/index.js',
        'lib/index.js.map',
        'lib/terminal.test.js',
        'lib/shared/conout.js',
        'build/Release/pty.node',
        'build/Release/spawn-helper',
        'build/Release/obj.target/pty.o',
        'prebuilds/darwin-arm64/pty.node',
      ]),
    ).toEqual([
      'package.json',
      'LICENSE',
      'lib/index.js',
      'lib/shared/conout.js',
      'build/Release/pty.node',
      'build/Release/spawn-helper',
    ]);
  });
});
