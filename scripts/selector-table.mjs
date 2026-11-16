/**
 * The store hooks and the docs' selector table agree (HIVE-417).
 *
 * `docs/state-and-data.md`'s "Selector hooks" table is how a reader finds what
 * the stores offer. #251 and #256 added hooks without a row, and the table
 * named hooks that had since been cut. Nothing checked either direction.
 *
 * - Every exported `use[A-Z]…` in `src/stores/*-store.ts` is named in the
 *   first cell of a table row (`` | `use… ``), or listed in
 *   `scripts/selector-doc-allow.json`.
 * - Every hook a row names is exported by a store or by `src/hooks/`.
 * - The list holds the hooks undocumented when this arrived, sorted, and only
 *   shrinks: a listed hook that is documented now, or exported by no store any
 *   more, fails until it is taken off.
 *
 * Store sources are parsed with the TypeScript compiler; the doc is Markdown,
 * read line by line.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseSource, ts } from './ts-source.mjs';

export const DOC_PATH = 'docs/state-and-data.md';
export const ALLOW_PATH = 'scripts/selector-doc-allow.json';

const HOOK = /^use[A-Z]\w*/;

/** Hooks named in the first cell of every `` | `use `` row, sorted and unique. */
export function readDocHooks(doc) {
  const hooks = new Set();
  for (const line of doc.split('\n')) {
    if (!line.startsWith('| `use')) continue;
    const firstCell = line.split('|')[1];
    for (const [, code] of firstCell.matchAll(/`([^`]+)`/g)) {
      const name = HOOK.exec(code);
      if (name) hooks.add(name[0]);
    }
  }
  return [...hooks].sort();
}

/** Exported `function use…` and `const use…` declared in `source`, sorted. */
export function readExportedHooks(source, fileName = 'source.ts') {
  const hooks = [];
  for (const statement of parseSource(source, fileName).statements) {
    const exported = ts
      .getModifiers?.(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      if (HOOK.test(statement.name.text)) hooks.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HOOK.test(declaration.name.text)) {
          hooks.push(declaration.name.text);
        }
      }
    }
  }
  return hooks.sort();
}

/** What is wrong; empty when the stores, the doc and the list agree. */
export function selectorTableProblems({ storeHooks, otherHooks, docHooks, allow }) {
  const problems = [];
  const sorted = [...allow].sort();
  if (sorted.some((name, index) => name !== allow[index])) {
    problems.push(`${ALLOW_PATH}: not sorted`);
  }
  const documented = new Set(docHooks);
  const allowed = new Set(allow);
  const exported = new Set([...storeHooks.values()].flat());
  const existing = new Set([...exported, ...otherHooks]);

  for (const [file, hooks] of storeHooks) {
    for (const hook of hooks) {
      if (!documented.has(hook) && !allowed.has(hook)) {
        problems.push(`${file}: ${hook} is not in ${DOC_PATH}'s selector table`);
      }
    }
  }
  for (const hook of docHooks) {
    if (!existing.has(hook)) {
      problems.push(`${DOC_PATH}: ${hook} names no export in src/stores/*-store.ts or src/hooks/`);
    }
  }
  for (const hook of allow) {
    if (documented.has(hook)) {
      problems.push(`${hook}: documented now; remove it from ${ALLOW_PATH}`);
    } else if (!exported.has(hook)) {
      problems.push(`${hook}: no store exports it; remove it from ${ALLOW_PATH}`);
    }
  }
  return problems;
}

/** `src/<dir>` files matching `pattern`, as `src/<dir>/<name>` paths. */
function filesIn(appRoot, dir, pattern) {
  const absolute = join(appRoot, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => `${dir}/${name}`);
}

/** Store hooks by file, and every other hook `src/hooks/` exports. */
export function readTreeHooks(appRoot) {
  const read = (path) => readExportedHooks(readFileSync(join(appRoot, path), 'utf8'), path);
  const storeHooks = new Map(
    filesIn(appRoot, 'src/stores', /-store\.tsx?$/).map((path) => [path, read(path)]),
  );
  const otherHooks = filesIn(appRoot, 'src/hooks', /\.tsx?$/).flatMap(read);
  return { storeHooks, otherHooks };
}

/** The check against the real tree, doc and committed list. */
export function selectorTableProblemsOnDisk(appRoot) {
  return selectorTableProblems({
    ...readTreeHooks(appRoot),
    docHooks: readDocHooks(readFileSync(join(appRoot, DOC_PATH), 'utf8')),
    allow: JSON.parse(readFileSync(join(appRoot, ALLOW_PATH), 'utf8')),
  });
}
