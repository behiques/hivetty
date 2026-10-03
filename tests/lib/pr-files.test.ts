import { describe, expect, it } from 'vitest';

import { fileTree, filesSummary, firstFile, threadMark } from '@lib/pr-files';
import { prFile, prThread } from '@tests/support/pr-detail';

const FILES = [
  prFile({ path: 'src/fees/validator.ts', viewed: 'viewed' }),
  prFile({ path: 'README.md', viewed: 'dismissed' }),
  prFile({ path: 'src/fees/delaware.rule.ts', viewed: 'viewed' }),
  prFile({ path: 'test/integration/fee-rule.spec.ts' }),
];

describe('fileTree', () => {
  it('groups by directory, root first, folders and names sorted', () => {
    expect(fileTree(FILES).map((g) => [g.dir, g.files.map((f) => f.path)])).toEqual([
      ['', ['README.md']],
      ['src/fees', ['src/fees/delaware.rule.ts', 'src/fees/validator.ts']],
      ['test/integration', ['test/integration/fee-rule.spec.ts']],
    ]);
  });
  it('filters by path, case-insensitively, and drops an emptied folder', () => {
    expect(fileTree(FILES, '  FEES/V ').map((g) => [g.dir, g.files.map((f) => f.path)])).toEqual([['src/fees', ['src/fees/validator.ts']]]);
  });
});

describe('filesSummary', () => {
  it('counts the total, open threads, and viewed with DISMISSED as not viewed', () => {
    const threads = [prThread(), prThread({ id: 'T2', isResolved: true })];
    expect(filesSummary(FILES, 9, threads)).toEqual({ files: 9, openThreads: 1, viewed: 2 });
  });
});

describe('threadMark', () => {
  it('is open with any open thread, resolved when all are, null with none', () => {
    const open = prThread();
    const done = prThread({ id: 'T2', isResolved: true });
    expect(threadMark('src/fees/validator.ts', [open, done])).toBe('open');
    expect(threadMark('src/fees/validator.ts', [done])).toBe('resolved');
    expect(threadMark('README.md', [open])).toBeNull();
  });
});

describe('firstFile', () => {
  it('is the first file in tree order with an open thread', () => {
    expect(firstFile(fileTree(FILES), [prThread()])).toBe('src/fees/validator.ts');
  });
  it('else the first file, else null', () => {
    expect(firstFile(fileTree(FILES), [prThread({ isResolved: true })])).toBe('README.md');
    expect(firstFile([], [])).toBeNull();
  });
});
