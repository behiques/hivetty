/**
 * Types for `release-smoke.mjs` (HIVE-417 item 10), so its pure half can be
 * unit-tested from the TypeScript test tree. The script stays `.mjs` because
 * `pnpm release:smoke` runs it with bare `node`.
 */

export const SMOKE_WINDOW_MS: number;
export const KILL_GRACE_MS: number;

export function builderArgs(outputDir: string): string[];

export function findAppBinary(outputDir: string, list: (dir: string) => string[]): string | null;

export function launchPlan(
  binary: string,
  tmp: string,
  baseEnv: Record<string, string | undefined>,
): { command: string; args: string[]; env: Record<string, string | undefined> };

export function isInside(path: string, root: string): boolean;

export function tailLines(text: string, n: number): string;

export function describeExit(
  exit: { code: number | null; signal: string | null; stderr: string },
  lines?: number,
): string;
