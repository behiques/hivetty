import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readDocHooks,
  readExportedHooks,
  selectorTableProblems,
  selectorTableProblemsOnDisk,
} from '../../scripts/selector-table.mjs';

const DOC = `
## Selector hooks

| Hook | Returns |
| --- | --- |
| \`useEntity(id)\` | one entity, or \`useNotAHook\` named in the second cell |
| \`useActiveSessions()\` / \`useEndedSessions()\` | two hooks in one cell |
| \`usePrDetail(prKey(owner, repo, n))\` | nested parentheses |

Prose that names \`useProse()\` does not count.
`;

describe('readDocHooks', () => {
  it('reads every backticked hook in the first cell of a | `use row', () => {
    expect(readDocHooks(DOC)).toEqual([
      'useActiveSessions',
      'useEndedSessions',
      'useEntity',
      'usePrDetail',
    ]);
  });
});

describe('readExportedHooks', () => {
  it('reads exported use[A-Z] functions and consts, not private or lowercase ones', () => {
    const source = `
export function useEntity(id: string) { return id; }
export const useCounts = () => 1;
export const useHiveStore = create(() => ({}));
const usePrivate = () => 1;
export function user() {}
export const useless = 1;
export { usePrivate as useRenamed };
`;
    expect(readExportedHooks(source)).toEqual(['useCounts', 'useEntity', 'useHiveStore']);
  });
});

describe('selectorTableProblems', () => {
  const base = {
    storeHooks: new Map([['src/stores/hive-store.ts', ['useEntity', 'useCounts']]]),
    otherHooks: ['useOnStage'],
    docHooks: ['useEntity', 'useOnStage'],
    allow: ['useCounts'],
  };

  it('passes when every store hook is documented or listed, and every doc hook exists', () => {
    expect(selectorTableProblems(base)).toEqual([]);
  });

  it('fires on a store hook the doc does not name', () => {
    expect(selectorTableProblems({ ...base, allow: [] })).toEqual([
      "src/stores/hive-store.ts: useCounts is not in docs/state-and-data.md's selector table",
    ]);
  });

  it('fires on a doc row naming a hook that does not exist', () => {
    expect(selectorTableProblems({ ...base, docHooks: [...base.docHooks, 'useGone'] })).toEqual([
      'docs/state-and-data.md: useGone names no export in src/stores/*-store.ts or src/hooks/',
    ]);
  });

  it('fires on a listed hook that is documented now, so the list only shrinks', () => {
    expect(
      selectorTableProblems({ ...base, docHooks: [...base.docHooks, 'useCounts'] }),
    ).toEqual(['useCounts: documented now; remove it from scripts/selector-doc-allow.json']);
  });

  it('fires on a listed hook no store exports any more', () => {
    expect(selectorTableProblems({ ...base, allow: ['useCounts', 'useRemoved'] })).toEqual([
      'useRemoved: no store exports it; remove it from scripts/selector-doc-allow.json',
    ]);
  });

  it('fires on an unsorted list', () => {
    const storeHooks = new Map([['src/stores/a-store.ts', ['useA', 'useB']]]);
    expect(
      selectorTableProblems({ storeHooks, otherHooks: [], docHooks: [], allow: ['useB', 'useA'] }),
    ).toEqual(['scripts/selector-doc-allow.json: not sorted']);
  });
});

describe('this tree', () => {
  it('matches docs/state-and-data.md and scripts/selector-doc-allow.json exactly', () => {
    expect(selectorTableProblemsOnDisk(join(__dirname, '..', '..'))).toEqual([]);
  });
});
