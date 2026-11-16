/**
 * Types for `bridge-list.mjs`, so the TypeScript test tree can import it. The
 * script stays `.mjs` because `verify-boundaries.mjs` runs it under bare `node`.
 */

export interface BridgeSources {
  bridgeKeys: string;
  securitySpec: string;
}

export const BRIDGE_KEYS_PATH: string;
export const SECURITY_SPEC_PATH: string;

export function readBridgeKeyLists(bridgeKeys: string): Map<string, string[]>;

export function readSpecSurfaceLists(
  securitySpec: string,
): Array<{ namespace: string; keys: string[] }>;

export function bridgeListProblems(sources: BridgeSources): string[];

export function readBridgeSources(appRoot: string): BridgeSources;
