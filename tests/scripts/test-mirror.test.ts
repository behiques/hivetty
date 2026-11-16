import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  listSourceFiles,
  mirrorCandidates,
  testMirrorProblems,
  testMirrorProblemsOnDisk,
} from '../../scripts/test-mirror.mjs';

describe('mirrorCandidates', () => {
  it('names the .test.ts and .test.tsx mirrors of a src file', () => {
    expect(mirrorCandidates('src/lib/x.ts')).toEqual([
      'tests/lib/x.test.ts',
      'tests/lib/x.test.tsx',
    ]);
    expect(mirrorCandidates('src/features/a/b.tsx')).toEqual([
      'tests/features/a/b.test.ts',
      'tests/features/a/b.test.tsx',
    ]);
  });
});

describe('testMirrorProblems', () => {
  const has = (tests: string[]) => (path: string) => tests.includes(path);

  it('passes when every file is mirrored or allow-listed', () => {
    expect(
      testMirrorProblems({
        sources: ['src/a.ts', 'src/b.tsx'],
        exists: has(['tests/a.test.ts']),
        allow: ['src/b.tsx'],
      }),
    ).toEqual([]);
  });

  it('accepts a .tsx test for a .ts file', () => {
    expect(
      testMirrorProblems({ sources: ['src/a.ts'], exists: has(['tests/a.test.tsx']), allow: [] }),
    ).toEqual([]);
  });

  it("fires on #229's miss: a new src file with no test", () => {
    expect(
      testMirrorProblems({ sources: ['src/lib/new.ts'], exists: has([]), allow: [] }),
    ).toEqual(['src/lib/new.ts: no tests/lib/new.test.ts(x)']);
  });

  it('fires on an allow-listed file that now has a test, so the list only shrinks', () => {
    expect(
      testMirrorProblems({
        sources: ['src/a.ts'],
        exists: has(['tests/a.test.ts']),
        allow: ['src/a.ts'],
      }),
    ).toEqual(['src/a.ts: has a test now; remove it from scripts/test-mirror-allow.json']);
  });

  it('fires on an allow-listed file that no longer exists', () => {
    expect(
      testMirrorProblems({ sources: [], exists: has([]), allow: ['src/gone.ts'] }),
    ).toEqual(['src/gone.ts: gone; remove it from scripts/test-mirror-allow.json']);
  });

  it('fires on an unsorted allow-list', () => {
    expect(
      testMirrorProblems({
        sources: ['src/a.ts', 'src/b.ts'],
        exists: has([]),
        allow: ['src/b.ts', 'src/a.ts'],
      }),
    ).toEqual(['scripts/test-mirror-allow.json: not sorted']);
  });
});

describe('listSourceFiles', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function tree(files: string[]): string {
    root = mkdtempSync(join(tmpdir(), 'mirror-'));
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), '');
    }
    return root;
  }

  it('walks src for .ts and .tsx, skipping .d.ts and other files, sorted', () => {
    const appRoot = tree([
      'src/b.tsx',
      'src/a/x.ts',
      'src/types.d.ts',
      'src/styles/x.css',
      'src/.gitkeep',
    ]);
    expect(listSourceFiles(appRoot)).toEqual(['src/a/x.ts', 'src/b.tsx']);
  });
});

describe('this tree', () => {
  it('matches scripts/test-mirror-allow.json exactly', () => {
    expect(testMirrorProblemsOnDisk(join(__dirname, '..', '..'))).toEqual([]);
  });
});
