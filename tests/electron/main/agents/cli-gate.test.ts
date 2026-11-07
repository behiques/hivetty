import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../electron/main/licence/entitled', () => ({
  cliEntitled: (id: string) => (id === 'claude-code' ? null : 'Sign in to use it'),
}));

import { createCliGate } from '../../../../electron/main/agents/cli-gate';
import { resolveClis } from '../../../../electron/shared/cli-contract';

describe('createCliGate (HIVE-341)', () => {
  it('reads enabled, the default CLI and the card defaults from config', () => {
    const gate = createCliGate(() => ({
      clis: resolveClis({ 'claude-code': { agents: { enabled: false, model: 'haiku' } } }),
      agentsDefaultCli: 'claude-code',
    }));

    expect(gate.enabled('claude-code')).toBe(false);
    expect(gate.defaultCli()).toBe('claude-code');
    expect(gate.defaults('claude-code')).toEqual({ model: 'haiku' });
    expect(gate.entitled('claude-code')).toBeNull();
  });

  it('reads config on every call, so an edit reaches the next wake', () => {
    let clis = resolveClis(undefined);
    const gate = createCliGate(() => ({ clis }));

    expect(gate.enabled('claude-code')).toBe(true);
    expect(gate.defaults('claude-code')).toEqual({});
    clis = resolveClis({ 'claude-code': { agents: { enabled: false, effort: 'max' } } });
    expect(gate.enabled('claude-code')).toBe(false);
    expect(gate.defaults('claude-code')).toEqual({ effort: 'max' });
    expect(gate.defaultCli()).toBeUndefined();
  });

  it("reads codex's model and sandbox from its card (HIVE-342)", () => {
    const gate = createCliGate(() => ({
      clis: resolveClis({
        codex: { agents: { enabled: true, model: 'gpt-6-luna', sandbox: 'read-only' } },
      }),
    }));

    expect(gate.defaults('codex')).toEqual({ model: 'gpt-6-luna', sandbox: 'read-only' });
  });

  it("reads copilot's deny patterns from its card (HIVE-343)", () => {
    const gate = createCliGate(() => ({
      clis: resolveClis({ copilot: { agents: { enabled: true, deny: ['shell(rm:*)'] } } }),
    }));

    expect(gate.defaults('copilot')).toEqual({ deny: ['shell(rm:*)'] });
  });

  it('answers entitled from the injected lease check (HIVE-332)', () => {
    const gate = createCliGate(
      () => ({ clis: resolveClis(undefined) }),
      (id) => (id === 'copilot' ? 'Copilot is in Team and above' : null),
    );

    expect(gate.entitled('codex')).toBeNull();
    expect(gate.entitled('copilot')).toBe('Copilot is in Team and above');
  });

  it('defaults entitled to the licence read (HIVE-332)', () => {
    expect(createCliGate(() => ({ clis: resolveClis(undefined) })).entitled('codex')).toBe('Sign in to use it');
  });
});
