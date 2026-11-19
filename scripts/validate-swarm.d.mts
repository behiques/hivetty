/**
 * Types for `validate-swarm.mjs`, so the TypeScript test tree can import it. The
 * script stays `.mjs` because `scripts/` is linted as `.mjs` only, and loads the
 * TypeScript reader through Vite's `runnerImport`.
 */

interface SwarmReadLike {
  manifest: { version: string } | null;
  problems: { field: string; reason: string }[];
}

type ReadSwarm = (dir: string) => Promise<SwarmReadLike>;

type ParseSwarmTag = (tag: string) => { folder: string; version: string } | null;

export function findSwarmFolders(repoDir: string): string[];

export function validateRepo(input: {
  repoDir: string;
  tag?: string;
  readSwarm: ReadSwarm;
  parseSwarmTag: ParseSwarmTag;
}): Promise<string[]>;

export function loadSwarmModules(): Promise<{ readSwarm: ReadSwarm; parseSwarmTag: ParseSwarmTag }>;
