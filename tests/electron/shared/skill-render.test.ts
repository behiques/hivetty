import { describe, expect, it } from 'vitest';

import {
  dropKeysFor,
  fillPlaceholders,
  missingFeatures,
  parseRequires,
  renderSkillText,
  typedSkill,
} from '../../../electron/shared/skill-render';

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

const GOAL = [
  '---',
  'name: goal-on',
  'description: holds a session',
  'requires: [stop-hook]',
  'hooks:',
  '  Stop:',
  '    - type: agent',
  '      prompt: |',
  '        line one',
  '',
  '        line two',
  'allowed-tools: Bash(x)',
  '---',
  '',
  'Body names {{skill:plan}}.',
  'hooks: this line is prose, not frontmatter',
].join('\n');

describe('renderSkillText', () => {
  it('drops only requires: for Claude Code', () => {
    expect(renderSkillText(GOAL, 'claude-code')).toBe(
      GOAL.replace('requires: [stop-hook]\n', '').replace('{{skill:plan}}', 'hive:plan'),
    );
  });
  it('drops requires:, hooks: (blank lines included) and allowed-tools for Codex', () => {
    expect(renderSkillText(GOAL, 'codex')).toBe(
      [
        '---',
        'name: goal-on',
        'description: holds a session',
        '---',
        '',
        'Body names $plan.',
        'hooks: this line is prose, not frontmatter',
      ].join('\n'),
    );
  });
  it('leaves a file with no frontmatter to the placeholders alone', () => {
    expect(renderSkillText('# Prompt\n{{tool:pr}}', 'copilot')).toBe('# Prompt\nhive-pr');
  });
  it('leaves an unterminated header alone', () => {
    const text = '---\nname: x\nrequires: [subagents]\n';
    expect(renderSkillText(text, 'codex')).toBe(text);
  });
});

describe('dropKeysFor', () => {
  it('keeps Claude-only keys for Claude Code', () => {
    expect(dropKeysFor('claude-code')).toEqual(['requires']);
    expect(dropKeysFor('codex')).toEqual(['requires', 'hooks', 'allowed-tools']);
  });
});

describe('parseRequires', () => {
  it('reads every flat form', () => {
    expect(parseRequires(undefined)).toEqual([]);
    expect(parseRequires('')).toEqual([]);
    expect(parseRequires('[subagents, stop-hook]')).toEqual(['subagents', 'stop-hook']);
    expect(parseRequires('subagents')).toEqual(['subagents']);
  });
  it('names an unknown feature', () => {
    expect(parseRequires('[teleport]')).toBe(
      'requires: "teleport" is not one of subagents, stop-hook, ask-tool, artifact.',
    );
  });
});

describe('missingFeatures', () => {
  it('is empty where the CLI has them all', () => {
    expect(missingFeatures(['subagents'], 'claude-code')).toEqual([]);
  });
  it('lists what the CLI lacks', () => {
    expect(missingFeatures(['subagents', 'stop-hook'], 'codex')).toEqual(['subagents', 'stop-hook']);
  });
});
