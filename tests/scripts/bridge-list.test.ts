import { describe, expect, it } from 'vitest';

import {
  bridgeListProblems,
  readBridgeKeyLists,
  readSpecSurfaceLists,
  readBridgeSources,
} from '../../scripts/bridge-list.mjs';

const KEYS = `
import type { HiveBridge } from '../../shared/ipc-contract';
export const BRIDGE_KEYS = [
  'agents', 'pty',
] as const satisfies readonly (keyof HiveBridge)[];
export const BRIDGE_PTY_KEYS = ['spawn', 'write'] as const;
export const BRIDGE_AGENTS_KEYS = ['run', 'kill'] as const;
`;

const SPEC = `
test('window.hive exposes only the documented verbs', async ({ page }) => {
  const surface = await page.evaluate(() => ({ top: [], pty: [], agents: [] }));
  expect(surface.top).toEqual([
    // HIVE-1: a comment that names 'notAKey' must not count
    'agents',
    /* 'alsoNotAKey' */
    'pty',
  ]);
  expect(surface.pty).toEqual(['spawn', 'write']);
  expect(surface.agents).toEqual(['kill', 'run']);
});
`;

describe('readBridgeKeyLists', () => {
  it('maps every exported BRIDGE_* array to its string members', () => {
    const lists = readBridgeKeyLists(KEYS);
    expect(lists.get('BRIDGE_KEYS')).toEqual(['agents', 'pty']);
    expect(lists.get('BRIDGE_PTY_KEYS')).toEqual(['spawn', 'write']);
  });
});

describe('readSpecSurfaceLists', () => {
  it('reads each expect(surface.<ns>).toEqual([...]) literal, ignoring comments', () => {
    const lists = readSpecSurfaceLists(SPEC);
    expect(lists).toEqual([
      { namespace: 'top', keys: ['agents', 'pty'] },
      { namespace: 'pty', keys: ['spawn', 'write'] },
      { namespace: 'agents', keys: ['kill', 'run'] },
    ]);
  });

  it('throws when the spec asserts no top-level list, rather than passing on nothing', () => {
    expect(() => readSpecSurfaceLists("expect(surface.pty).toEqual(['a']);")).toThrow(
      /surface\.top/,
    );
  });
});

describe('bridgeListProblems', () => {
  it('passes when every asserted list matches its BRIDGE_* array as a set', () => {
    expect(bridgeListProblems({ bridgeKeys: KEYS, securitySpec: SPEC })).toEqual([]);
  });

  it("fires on #238's miss: a key in BRIDGE_KEYS the spec's list lacks", () => {
    const keys = KEYS.replace("'agents', 'pty',", "'agents', 'pty', 'slack',");
    const problems = bridgeListProblems({ bridgeKeys: keys, securitySpec: SPEC });
    expect(problems).toEqual([
      'surface.top: in BRIDGE_KEYS, missing from security.spec.ts: slack',
    ]);
  });

  it('fires on a namespace verb the spec lists but BRIDGE_* does not', () => {
    const spec = SPEC.replace("['spawn', 'write']", "['spawn', 'write', 'resize']");
    const problems = bridgeListProblems({ bridgeKeys: KEYS, securitySpec: spec });
    expect(problems).toEqual([
      'surface.pty: in security.spec.ts, missing from BRIDGE_PTY_KEYS: resize',
    ]);
  });

  it('fires when the spec asserts a namespace with no BRIDGE_* array', () => {
    const spec = SPEC.replace("expect(surface.pty)", "expect(surface.nope)");
    const problems = bridgeListProblems({ bridgeKeys: KEYS, securitySpec: spec });
    expect(problems).toEqual([
      'surface.nope: no BRIDGE_NOPE_KEYS in bridge-keys.ts',
      'BRIDGE_PTY_KEYS: no expect(surface.pty).toEqual([...]) in security.spec.ts',
    ]);
  });

  it('fires when a BRIDGE_*_KEYS array has no spec list (acr on #307)', () => {
    const keys = `${KEYS}export const BRIDGE_PROBE_KEYS = ['poke'] as const;\n`;
    const problems = bridgeListProblems({ bridgeKeys: keys, securitySpec: SPEC });
    expect(problems).toEqual([
      'BRIDGE_PROBE_KEYS: no expect(surface.probe).toEqual([...]) in security.spec.ts',
    ]);
  });

  it('reads a multi-word namespace back from its array name', () => {
    const keys = `${KEYS}export const BRIDGE_CHANGED_FILES_KEYS = ['list'] as const;\n`;
    const problems = bridgeListProblems({ bridgeKeys: keys, securitySpec: SPEC });
    expect(problems).toEqual([
      'BRIDGE_CHANGED_FILES_KEYS: no expect(surface.changedFiles).toEqual([...]) in security.spec.ts',
    ]);
  });
});

describe('this tree', () => {
  it('has a security spec whose lists match bridge-keys.ts', () => {
    expect(bridgeListProblems(readBridgeSources(`${__dirname}/../..`))).toEqual([]);
  });
});
