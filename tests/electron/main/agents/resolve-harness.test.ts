// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  checkHarness,
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
  defaults: () => ({}),
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
        'No CLI can run reviewer: codex cannot start: claude was not found on PATH; claude-code cannot start: claude was not found on PATH.',
    });
  });

  it('skips a CLI the licence does not allow', () => {
    const result = resolveHarness(prefer, [], deps(both, {
      gate: gate({ entitled: (id) => (id === cli('codex') ? 'not in your plan (Solo or higher)' : null) }),
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
        entitled: (id) => (id === cli('codex') ? 'not in your plan (Solo or higher)' : null),
        enabled: (id) => id !== 'claude-code',
      }),
    }));

    expect(result).toEqual({
      problem:
        'No CLI can run reviewer: codex: not in your plan (Solo or higher); claude-code is turned off for agents in Settings › Harnesses.',
    });
  });

  it('resolves again on every call: a lapse between two wakes moves the next one', () => {
    let entitled = true;
    const lapsing = gate({ entitled: (id) => (id === cli('codex') && !entitled ? 'not in your plan (Solo or higher)' : null) });

    expect(resolveHarness(prefer, [], deps(both, { gate: lapsing }))).toMatchObject({ adapter: both.codex });
    entitled = false;
    expect(resolveHarness(prefer, [], deps(both, { gate: lapsing }))).toMatchObject({ adapter: both['claude-code'] });
  });
});

describe('resolveHarness: can it honour this definition (HIVE-340)', () => {
  const claude = fake('claude-code');

  it('asks the fence about the rules it is given, all of them', () => {
    const seen: string[][] = [];
    const watching = fake('claude-code', {
      express: (rules) => {
        seen.push([...rules]);
        return { ok: true };
      },
    });

    resolveHarness(def(), ['Read', 'ToolSearch', 'literal:Bash:git push'], deps({ 'claude-code': watching }));

    expect(seen).toEqual([['Read', 'ToolSearch', 'literal:Bash:git push']]);
  });

  it('skips a CLI that cannot enforce a rule, naming the tool and never its argument', () => {
    const blind = fake('claude-code', {
      express: () => ({ ok: false, unexpressible: ['Bash(cat /Users/u/.ssh/id_rsa)', 'Bash(git:*)', 'WebFetch'] }),
    });
    const result = resolveHarness(def(), [], deps({ 'claude-code': blind }));

    expect(result).toEqual({ problem: 'No CLI can run reviewer: claude-code cannot enforce Bash, WebFetch.' });
    expect(JSON.stringify(result)).not.toContain('/Users');
  });

  it('names the tool of a one-shot literal rule, never its specifier', () => {
    const blind = fake('claude-code', {
      express: () => ({ ok: false, unexpressible: ['literal:Bash:cat /Users/u/.ssh/id_rsa'] }),
    });
    const result = resolveHarness(def(), [], deps({ 'claude-code': blind }));

    expect(result).toEqual({ problem: 'No CLI can run reviewer: claude-code cannot enforce Bash.' });
  });

  it('skips a CLI that reports no tokens when the agent has a daily token cap (HIVE-398)', () => {
    const blind = { codex: fake('codex', { caps: { reportsTokens: false } }), 'claude-code': claude };
    const limits = { turns: 40, rotateAfter: 50, parallel: 1, dailyTokens: 2_000_000 };

    expect(resolveHarness(def({ harness: [cli('codex')], limits }), [], deps(blind, { gate: gate() }))).toEqual({
      problem: "No CLI can run reviewer: codex does not report token usage, which reviewer's daily token cap needs.",
    });
  });

  it('runs a token-capped agent with no USD limit on a CLI that reports no cost (HIVE-398)', () => {
    const codex = fake('codex', { caps: { reportsCostUsd: false } });
    const limits = { turns: 40, rotateAfter: 50, parallel: 1, dailyTokens: 2_000_000 };

    expect(
      resolveHarness(def({ harness: [cli('codex')], limits }), [], deps({ codex, 'claude-code': claude }, { gate: gate() })),
    ).toMatchObject({ adapter: codex });
  });

  it('skips a CLI that reports no USD cost when the agent has a budget or a daily ceiling', () => {
    const blind = { codex: fake('codex', { caps: { reportsCostUsd: false } }), 'claude-code': claude };

    for (const limits of [
      { turns: 40, rotateAfter: 50, parallel: 1, budgetUsd: 1 },
      { turns: 40, rotateAfter: 50, parallel: 1, dailyUsd: 5 },
    ]) {
      const result = resolveHarness(def({ harness: [cli('codex')], limits }), [], deps(blind, { gate: gate() }));

      expect(result).toEqual({
        problem: "No CLI can run reviewer: codex does not report cost in USD, which reviewer's budget limit needs.",
      });
    }

    expect(resolveHarness(def({ harness: [cli('codex')] }), [], deps(blind, { gate: gate() }))).toMatchObject({ adapter: blind.codex });
  });

  it('skips a CLI that cannot serve an mcp: integration', () => {
    const adapters = { codex: fake('codex', { caps: { agentMcp: [] } }), 'claude-code': claude };
    const result = resolveHarness(
      def({ harness: [cli('codex'), 'claude-code'], mcp: ['slack'] }),
      [],
      deps(adapters, { gate: gate() }),
    );

    expect(result).toMatchObject({ adapter: claude });
    expect(
      resolveHarness(def({ harness: [cli('codex')], mcp: ['slack'] }), [], deps(adapters, { gate: gate() })),
    ).toEqual({ problem: 'No CLI can run reviewer: codex cannot serve the slack integration.' });
  });
});

describe('resolveHarness: fail closed (HIVE-332)', () => {
  it('with no gate, refuses Codex and Copilot and still runs Claude', () => {
    const claude = fake('claude-code');
    const codex = fake('codex');
    const copilot = fake('copilot');
    const adapters = { 'claude-code': claude, codex, copilot };

    expect(resolveHarness(def({ harness: [cli('codex')] }), [], deps(adapters))).toEqual({
      problem: 'No CLI can run reviewer: codex: not entitled: no licence gate.',
    });
    expect(resolveHarness(def({ harness: [cli('copilot'), 'claude-code'] }), [], deps(adapters))).toMatchObject({
      adapter: claude,
    });
  });

  it("names the CLI before the licence's own sentence, which already reads whole", () => {
    const copilot = fake('copilot');
    const lease = gate({ entitled: (id) => (id === cli('copilot') ? 'Copilot is in Team and above' : null) });

    expect(resolveHarness(def({ harness: [cli('copilot')] }), [], deps({ copilot }, { gate: lease }))).toEqual({
      problem: 'No CLI can run reviewer: copilot: Copilot is in Team and above.',
    });
  });

  it('with a gate, its entitled() decides', () => {
    const codex = fake('codex');
    expect(resolveHarness(def({ harness: [cli('codex')] }), [], deps({ codex }, { gate: gate() }))).toMatchObject({
      adapter: codex,
    });
  });
});

describe('checkHarness: a fix for each failure (HIVE-396)', () => {
  const claude = fake('claude-code');
  const fail = (result: ReturnType<typeof checkHarness>) => {
    if ('pass' in result) throw new Error('expected a failure');
    return result;
  };

  it('passes the same CLI resolveHarness would run', () => {
    expect(checkHarness(def(), [], deps({ 'claude-code': claude }), 'claude-code')).toEqual({
      pass: { adapter: claude, path: '/bin/claude-code' },
    });
  });

  it.each<[string, Partial<ResolveDeps>, Partial<AgentDefinition>, string | undefined]>([
    ['a missing binary', { binary: () => ({ problem: 'not found' }) }, {}, 'install'],
    ['a missing token', { binary: () => ({ problem: 'no token', fix: 'sign-in' }) }, {}, 'sign-in'],
    ['a plan lock', { gate: gate({ entitled: () => 'Copilot is in Team and above' }) }, {}, 'upgrade'],
    ['the agents switch', { gate: gate({ enabled: () => false }) }, {}, 'enable'],
  ])('%s', (_label, over, defOver, fix) => {
    expect(fail(checkHarness(def(defOver), [], deps({ 'claude-code': claude }, over), 'claude-code')).fix).toBe(fix);
  });

  it('a budget on a CLI that reports no cost', () => {
    const codex = fake('codex', { caps: { reportsCostUsd: false } });
    const result = fail(
      checkHarness(
        def({ limits: { turns: 40, rotateAfter: 50, parallel: 1, budgetUsd: 1 } }),
        [],
        deps({ codex }, { gate: gate() }),
        cli('codex'),
      ),
    );
    expect(result.fix).toBe('remove-budget');
  });

  it('a daily token cap on a CLI that reports no tokens (HIVE-398)', () => {
    const codex = fake('codex', { caps: { reportsTokens: false } });
    const result = fail(
      checkHarness(
        def({ limits: { turns: 40, rotateAfter: 50, parallel: 1, dailyTokens: 1_000 } }),
        [],
        deps({ codex }, { gate: gate() }),
        cli('codex'),
      ),
    );
    expect(result.fix).toBe('remove-budget');
  });

  it('an integration the CLI cannot serve', () => {
    const codex = fake('codex', { caps: { agentMcp: [] } });
    expect(fail(checkHarness(def({ mcp: ['slack'] }), [], deps({ codex }, { gate: gate() }), cli('codex'))).fix).toBe(
      'remove-mcp',
    );
  });

  it('no fix for a rule the fence cannot express, or no runner', () => {
    const codex = fake('codex', { express: () => ({ ok: false, unexpressible: ['Bash(git push)'] }) });
    expect(fail(checkHarness(def(), [], deps({ codex }, { gate: gate() }), cli('codex'))).fix).toBeUndefined();
    expect(fail(checkHarness(def(), [], deps({}), 'claude-code')).fix).toBeUndefined();
  });

  it("leaves resolveHarness's sentence unchanged", () => {
    expect(
      resolveHarness(def(), [], deps({ 'claude-code': claude }, { binary: () => ({ problem: 'not found' }) })),
    ).toEqual({
      problem: 'No CLI can run reviewer: claude-code cannot start: not found.',
    });
  });
});
