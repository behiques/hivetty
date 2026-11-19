/**
 * `pnpm swarm:validate <repoDir> [--tag <tag>]` (HIVE-439).
 *
 * Runs the app's own swarm reader, `core/swarms/manifest.ts`, over every swarm
 * in a repo: one at the root (`<repoDir>/swarm.json`), or one per immediate
 * subfolder that holds a `swarm.json`. With `--tag`, it also checks that the
 * tag names one of those swarms at the version its `swarm.json` declares.
 * hivetty-swarms' CI runs it on every push and tag.
 *
 * `.mjs`, like every script here, because `scripts/` is linted as `.mjs`
 * only. The reader is TypeScript, so `loadSwarmModules` loads it through
 * Vite's `runnerImport` with the aliases from `vite.aliases.mjs`: that
 * resolves `@shared` and the extensionless imports with no build step and no
 * new dependency. The folder discovery and the tag check take the reader as an
 * argument, so the unit test never loads Vite.
 */
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST = 'swarm.json';

/** `['']` for a root swarm, else the sorted subfolders holding a swarm.json. */
export function findSwarmFolders(repoDir) {
  if (existsSync(join(repoDir, MANIFEST))) return [''];

  return readdirSync(repoDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(repoDir, entry.name, MANIFEST)),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/** The failure lines for a repo, empty when it is valid. */
export async function validateRepo({ repoDir, tag, readSwarm, parseSwarmTag }) {
  if (!statSync(repoDir, { throwIfNoEntry: false })?.isDirectory()) return [`${repoDir} is not a directory`];

  const folders = findSwarmFolders(repoDir);
  if (folders.length === 0) return [`no swarm.json found in ${repoDir} or its folders`];

  const lines = [];
  const versions = new Map();

  for (const folder of folders) {
    const read = await readSwarm(folder === '' ? repoDir : join(repoDir, folder));
    for (const problem of read.problems) {
      lines.push(`${folder === '' ? '.' : folder}: ${problem.field === '' ? 'swarm' : problem.field}: ${problem.reason}`);
    }
    versions.set(folder, read.manifest?.version ?? null);
  }

  if (tag !== undefined) {
    const parsed = parseSwarmTag(tag);
    if (parsed === null) {
      lines.push(`tag ${tag} is not v<x.y.z> or <folder>/v<x.y.z>`);
    } else if (!versions.has(parsed.folder)) {
      lines.push(`tag ${tag} names ${parsed.folder}, which is not a swarm in this repo`);
    } else {
      const declared = versions.get(parsed.folder);
      if (declared !== null && declared !== parsed.version) {
        const manifest = parsed.folder === '' ? MANIFEST : `${parsed.folder}/${MANIFEST}`;
        lines.push(`tag ${tag} is version ${parsed.version} but ${manifest} says ${declared}`);
      }
    }
  }

  return lines;
}

/** Load the reader and the tag rule from this checkout's TypeScript. PR 2's swarm-pull reuses it. */
export async function loadSwarmModules() {
  const { runnerImport } = await import('vite');
  const { aliases } = await import('../vite.aliases.mjs');
  const appRoot = resolve(import.meta.dirname, '..');
  const config = { configFile: false, logLevel: 'error', resolve: { alias: aliases } };

  const reader = await runnerImport(join(appRoot, 'core', 'swarms', 'manifest.ts'), config);
  const contract = await runnerImport(join(appRoot, 'shared', 'swarm-contract.ts'), config);

  return { readSwarm: reader.module.readSwarm, parseSwarmTag: contract.module.parseSwarmTag };
}

// Node realpaths the main module's URL but not argv[1], so a symlinked path compares real to real.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const tagAt = args.indexOf('--tag');
  const tag = tagAt === -1 ? undefined : args[tagAt + 1];
  const repoDir = args.find((arg, index) => !arg.startsWith('--') && (tagAt === -1 || index !== tagAt + 1));

  if (repoDir === undefined || (tagAt !== -1 && tag === undefined)) {
    console.error('usage: pnpm swarm:validate <repoDir> [--tag <tag>]');
    process.exit(1);
  }

  const modules = await loadSwarmModules();
  const lines = await validateRepo({ repoDir: resolve(repoDir), tag, ...modules });

  if (lines.length > 0) {
    for (const line of lines) console.error(line);
    process.exit(1);
  }

  console.log(`${String(findSwarmFolders(resolve(repoDir)).length)} swarm(s) valid`);
}
