/**
 * Types for `pack-server.mjs` (HIVE-425), so its pure half can be unit-tested from the TypeScript test tree. The
 * script stays `.mjs` because `pnpm server:pack` runs it with bare `node`.
 */

export const NODE_VERSION: string;
export const NODE_SHA256: { arm64: string; x64: string };

export function tarballName(version: string, arch: string): string;

/** Throws `checksum mismatch` unless `bytes` hash to `expected`. */
export function verifySha256(bytes: Uint8Array, expected: string): void;

export function ptyRuntimeFiles(files: string[]): string[];
