import { describe, expect, it } from 'vitest';

import { fillPlaceholders, typedSkill } from '../../../electron/shared/skill-render';

const SOURCE = 'Call {{tool:ledger_ask}}, then {{skill:plan}} from "{{plugin_root}}/x".';

describe('fillPlaceholders', () => {
  it('fills Claude Code', () => {
    expect(fillPlaceholders(SOURCE, 'claude-code')).toBe(
      'Call mcp__hive__ledger_ask, then hive:plan from "$CLAUDE_PLUGIN_ROOT/x".',
    );
  });
  it('fills Codex', () => {
    expect(fillPlaceholders(SOURCE, 'codex')).toBe('Call mcp__hive__ledger_ask, then $plan from "$HIVE_PLUGIN_ROOT/x".');
  });
  it('fills Copilot', () => {
    expect(fillPlaceholders(SOURCE, 'copilot')).toBe('Call hive-ledger_ask, then /plan from "$HIVE_PLUGIN_ROOT/x".');
  });
  it('leaves text without placeholders exactly as it is', () => {
    const text = 'Use mcp__hive__x and {{ other }} and {{tool:Bad Name}}.';
    expect(fillPlaceholders(text, 'copilot')).toBe(text);
  });
});

describe('typedSkill', () => {
  it('types each CLI its own way', () => {
    expect(typedSkill('hive:work-on', 'claude-code')).toBe('/hive:work-on');
    expect(typedSkill('hive:work-on', 'codex')).toBe('$work-on');
    expect(typedSkill('hive:work-on', 'copilot')).toBe('/work-on');
  });
  it('keeps a name outside hive as stored', () => {
    expect(typedSkill('graphify', 'claude-code')).toBe('/graphify');
    expect(typedSkill('graphify', 'codex')).toBe('$graphify');
  });
});
