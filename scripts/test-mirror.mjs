/**
 * Tests mirror `src/` (AGENTS.md), with a list that only shrinks (HIVE-417).
 *
 * The rule was review-only, so #229 shipped a new src file with no test and
 * nobody noticed until coverage drifted. Every `src/**\/*.ts(x)` (not `.d.ts`)
 * needs `tests/<same path>.test.ts` or `.test.tsx`. The files that lacked one
 * when the check arrived are named in `scripts/test-mirror-allow.json`, sorted.
 * The check fails on a new unmirrored file, and on a listed file that has a
 * test now or no longer exists, so the list can only get shorter.
 *
 * The walk reads the disk, not `git ls-files`: an untracked new file is
 * exactly the one to catch before it is committed.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ALLOW_PATH = 'scripts/test-mirror-allow.json';

/** Every `.ts`/`.tsx` under `src/`, not `.d.ts`, as sorted `src/…` paths. */
export function listSourceFiles(appRoot) {
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(join(appRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(path);
    }
  };
  walk('src');
  return found.sort();
}

/** `src/a/b.tsx` → `['tests/a/b.test.ts', 'tests/a/b.test.tsx']`. */
export function mirrorCandidates(source) {
  const base = source.replace(/^src\//, 'tests/').replace(/\.tsx?$/, '');
  return [`${base}.test.ts`, `${base}.test.tsx`];
}

/** What is wrong; empty when every file is mirrored or listed and the list is exact. */
export function testMirrorProblems({ sources, exists, allow }) {
  const problems = [];
  const sorted = [...allow].sort();
  if (sorted.some((path, index) => path !== allow[index])) {
    problems.push(`${ALLOW_PATH}: not sorted`);
  }
  const allowed = new Set(allow);
  const present = new Set(sources);
  for (const source of sources) {
    const mirrored = mirrorCandidates(source).some(exists);
    if (!mirrored && !allowed.has(source)) {
      problems.push(`${source}: no ${mirrorCandidates(source)[0]}(x)`);
    } else if (mirrored && allowed.has(source)) {
      problems.push(`${source}: has a test now; remove it from ${ALLOW_PATH}`);
    }
  }
  for (const path of allow) {
    if (!present.has(path)) problems.push(`${path}: gone; remove it from ${ALLOW_PATH}`);
  }
  return problems;
}

/** The check against the real tree and the committed allow-list. */
export function testMirrorProblemsOnDisk(appRoot) {
  return testMirrorProblems({
    sources: listSourceFiles(appRoot),
    exists: (path) => existsSync(join(appRoot, path)),
    allow: JSON.parse(readFileSync(join(appRoot, ALLOW_PATH), 'utf8')),
  });
}
