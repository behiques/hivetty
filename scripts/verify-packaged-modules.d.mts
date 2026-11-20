/**
 * Types for `verify-packaged-modules.mjs`.
 *
 * The script stays `.mjs` because it runs under bare `node` from electron-builder's `afterPack`, where no build step
 * exists to compile a `.ts`. This declaration is what lets it be unit-tested from the TypeScript test tree.
 */

/** The names among `agents`, `skills` and `shipped-history.json` that exist in `resourcesDir` (HIVE-448). */
export function forbiddenResources(resourcesDir: string): string[];

/** The verdict for one archive: unresolved modules, unsatisfied peers, and whether `main` is in there. */
export function verifyArchive(archive: string): { ok: boolean; message: string; packageCount: number };

/** electron-builder `afterPack`. */
export default function verifyPackagedModules(context: {
  appOutDir: string;
  packager: { appInfo: { productFilename: string } };
}): Promise<void>;
