/**
 * Types for `test-mirror.mjs`, so the TypeScript test tree can import it. The
 * script stays `.mjs` because `verify-boundaries.mjs` runs it under bare `node`.
 */

export const ALLOW_PATH: string;

export function listSourceFiles(appRoot: string): string[];

export function mirrorCandidates(source: string): [string, string];

export function testMirrorProblems(input: {
  sources: string[];
  exists: (path: string) => boolean;
  allow: string[];
}): string[];

export function testMirrorProblemsOnDisk(appRoot: string): string[];
