import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * HIVE-242: HiveTTY's shipped text never points at The Hive.
 *
 * The skills and agents under `resources/` are copied verbatim into the plugin
 * every session loads, so a `~/.hive/` left in one makes a HiveTTY session write
 * its goals and plans into The Hive's folder. The docs follow the same rule.
 * The repo working folder `<repo>/.hive/` is a different thing and is allowed.
 */
// Read via cwd, not `import.meta.url`: the test environment is happy-dom, where
// `import.meta.url` is not a `file:` URL (as `tests/design-system.test.ts` does).
const ROOT = process.cwd();
const TEXT = /\.(md|mjs|js|ts|tsx|json|yml|yaml|mmd|plist)$/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path);
    return TEXT.test(name) ? [path] : [];
  });

const filesUnder = (...dirs: string[]) => dirs.flatMap((d) => walk(join(ROOT, d)));

const offenders = (files: string[], pattern: RegExp, allow: (rel: string) => boolean = () => false) =>
  files
    .map((f) => relative(ROOT, f))
    .filter((rel) => !allow(rel) && pattern.test(readFileSync(join(ROOT, rel), 'utf8')));

describe('fork identity (HIVE-242)', () => {
  const shipped = filesUnder('resources');
  const docs = [...filesUnder('docs', '.claude'), join(ROOT, 'AGENTS.md'), join(ROOT, 'README.md')];

  it('ships no path into The Hive’s home folder', () => {
    expect(offenders(shipped, /~\/\.hive\b|\$HOME\/\.hive\b|homedir\(\),\s*'\.hive'/)).toEqual([]);
  });

  // AGENTS.md names `~/.hive` to fence it off: only the importer reads it (HIVE-249).
  it('documents no path into The Hive’s home folder', () => {
    expect(offenders(docs, /~\/\.hive\b/, (rel) => rel === 'AGENTS.md')).toEqual([]);
  });

  it('says HiveTTY, never the old display name', () => {
    expect(offenders([...shipped, ...docs], /Hive TTY/)).toEqual([]);
  });

  it('points at behiques/hivetty, not the upstream repo', () => {
    const upstreamAllowed = (rel: string) => rel === 'docs/packaging-and-updates.md';
    expect(offenders([...shipped, ...docs], /yunidbauza\/the-hive/, upstreamAllowed)).toEqual([]);
  });
});
