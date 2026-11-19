/**
 * Types for `swarm-pull.mjs`, so the TypeScript test tree can import it. The
 * script stays `.mjs` because `scripts/` is linted as `.mjs` only.
 */

interface SwarmReadLike {
  manifest: { version: string } | null;
  problems: { field: string; reason: string }[];
}

type ReadSwarm = (dir: string) => Promise<SwarmReadLike>;

type ParseSwarmTag = (tag: string) => { folder: string; version: string } | null;

export interface SwarmLock {
  repo: string;
  tag: string;
  commit: string;
  files: Record<string, string>;
}

export const SWARM_REPO: string;

export const LOCK_FILE: string;

export function hashTree(resourcesDir: string): Record<string, string>;

export function readLock(resourcesDir: string): SwarmLock;

export function pullSwarm(input: {
  tag: string;
  repoUrl: string;
  resourcesDir: string;
  readSwarm: ReadSwarm;
  parseSwarmTag: ParseSwarmTag;
}): Promise<SwarmLock>;
