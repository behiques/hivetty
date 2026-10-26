// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  firstPassing,
  resolveHarness,
  type HarnessGate,
  type ResolveDeps,
} from '../../../../electron/main/agents/resolve-harness';
import { claudeCodeAdapter } from '../../../../electron/main/harness/claude-code';
import type { HarnessAdapter, PermissionFence } from '../../../../electron/main/harness/port';
import type { AgentDefinition } from '../../../../electron/shared/agent-contract';
import type { Capabilities, HarnessId } from '../../../../electron/shared/harness-contract';

/** A CLI this build has no adapter for, spelled for a fixture (HIVE-342 and HIVE-343 add them). */
const cli = (id: string): HarnessId => id as HarnessId;

const def = (over: Partial<AgentDefinition> = {}): AgentDefinition => ({
  name: 'reviewer',
  description: 'Reviews.',
  icon: 'Robot',
  wake: { on: [] },
  skills: [],
  mcp: [],
  tools: ['Read'],
  autonomy: 'ask',
  limits: { turns: 40, rotateAfter: 50, parallel: 1 },
  body: 'Review.',
  ...over,
});

const fake = (
  id: string,
  over: { caps?: Partial<Capabilities>; express?: PermissionFence['express'] } = {},
): HarnessAdapter => ({
  ...claudeCodeAdapter,
  id: cli(id),
  capabilities: { ...claudeCodeAdapter.capabilities, ...over.caps },
  headless: {
    ...claudeCodeAdapter.headless,
    fence: { express: over.express ?? (() => ({ ok: true })) },
  },
});

const deps = (adapters: Record<string, HarnessAdapter>, over: Partial<ResolveDeps> = {}): ResolveDeps => ({
  adapter: (id) => adapters[id],
  binary: (id) => ({ path: `/bin/${id}` }),
  ...over,
});

const gate = (over: Partial<HarnessGate> = {}): HarnessGate => ({
  entitled: () => null,
  enabled: () => true,
  defaultCli: () => undefined,
  ...over,
});

describe('firstPassing', () => {
  it('takes the first id that passes and checks no further', () => {
    const asked: string[] = [];
    const result = firstPassing(['a', 'b', 'c'], (id) => {
      asked.push(id);
      return id === 'b' ? { pass: id } : { fail: `${id} no` };
    });

    expect(result).toEqual({ pass: 'b' });
    expect(asked).toEqual(['a', 'b']);
  });

  it('answers every reason, in order, when none passes', () => {
    expect(firstPassing(['a', 'b'], (id) => ({ fail: `${id} no` }))).toEqual({ fail: ['a no', 'b no'] });
  });
});

describe('resolveHarness: candidates (HIVE-340)', () => {
  const claude = fake('claude-code');

  it('runs claude-code when the definition and the settings name nothing', () => {
    expect(resolveHarness(def(), [], deps({ 'claude-code': claude }))).toEqual({
      adapter: claude,
      path: '/bin/claude-code',
    });
  });

  it("takes the definition's list in order, skipping what cannot run", () => {
    const result = resolveHarness(def({ harness: [cli('codex'), 'claude-code'] }), [], deps({ 'claude-code': claude }));

    expect(result).toMatchObject({ adapter: claude });
  });

  it('falls back to the Settings default, and not past it to claude-code', () => {
    const result = resolveHarness(
      def(),
      [],
      deps({ 'claude-code': claude }, { gate: gate({ defaultCli: () => cli('copilot') }) }),
    );

    expect(result).toEqual({
      problem: 'No CLI can run reviewer: copilot has no headless runner in this build.',
    });
  });

  it("prefers the definition's list over the Settings default", () => {
    const result = resolveHarness(
      def({ harness: ['claude-code'] }),
      [],
      deps({ 'claude-code': claude }, { gate: gate({ defaultCli: () => cli('copilot') }) }),
    );

    expect(result).toMatchObject({ adapter: claude });
  });
});

describe('resolveHarness: availability (HIVE-340)', () => {
  const both = { codex: fake('codex'), 'claude-code': fake('claude-code') };
  const prefer = def({ harness: [cli('codex'), 'claude-code'] });

  it('skips a CLI that cannot start, naming why', () => {
    const result = resolveHarness(prefer, [], deps(both, {
      binary: () => ({ problem: 'claude was not found on PATH.' }),
    }));

    expect(result).toEqual({
      problem:
        'No CLI can run reviewer: codex cannot start: claude was not found on PATH.; claude-code cannot start: claude was not found on PATH..',
    });
  });

  it('skips a CLI the licence does not allow', () => {
    const result = resolveHarness(prefer, [], deps(both, {
      gate: gate({ entitled: (id) => (id === cli('codex') ? 'not in your plan (Starter or higher)' : null) }),
    }));

    expect(result).toMatchObject({ adapter: both['claude-code'] });
  });

  it('skips a CLI turned off for agents', () => {
    const result = resolveHarness(prefer, [], deps(both, { gate: gate({ enabled: (id) => id !== cli('codex') }) }));

    expect(result).toMatchObject({ adapter: both['claude-code'] });
  });

  it('names every candidate and why, when none can run', () => {
    const result = resolveHarness(prefer, [], deps(both, {
      gate: gate({
        entitled: (id) => (id === cli('codex') ? 'not in your plan (Starter or higher)' : null),
        enabled: (id) => id !== 'claude-code',
      }),
    }));

    expect(result).toEqual({
      problem:
        'No CLI can run reviewer: codex is not in your plan (Starter or higher); claude-code is turned off for agents in Settings › CLIs.',
    });
  });

  it('resolves again on every call: a lapse between two wakes moves the next one', () => {
    let entitled = true;
    const lapsing = gate({ entitled: (id) => (id === cli('codex') && !entitled ? 'not in your plan (Starter or higher)' : null) });

    expect(resolveHarness(prefer, [], deps(both, { gate: lapsing }))).toMatchObject({ adapter: both.codex });
    entitled = false;
    expect(resolveHarness(prefer, [], deps(both, { gate: lapsing }))).toMatchObject({ adapter: both['claude-code'] });
  });
});
