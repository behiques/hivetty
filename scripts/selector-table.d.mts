/**
 * Types for `selector-table.mjs`, so the TypeScript test tree can import it.
 * The script stays `.mjs` because `verify-boundaries.mjs` runs it under bare
 * `node`.
 */

export const DOC_PATH: string;
export const ALLOW_PATH: string;

export function readDocHooks(doc: string): string[];

export function readExportedHooks(source: string, fileName?: string): string[];

export function selectorTableProblems(input: {
  storeHooks: Map<string, string[]>;
  otherHooks: string[];
  docHooks: string[];
  allow: string[];
}): string[];

export function readTreeHooks(appRoot: string): {
  storeHooks: Map<string, string[]>;
  otherHooks: string[];
};

export function selectorTableProblemsOnDisk(appRoot: string): string[];
