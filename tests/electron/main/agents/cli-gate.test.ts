import { describe, expect, it } from 'vitest';

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
});
