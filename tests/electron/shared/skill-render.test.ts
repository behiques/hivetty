import { describe, expect, it } from 'vitest';

import {
  dropKeysFor,
  fillPlaceholders,
  guardSkill,
  makePortable,
  portabilityIssues,
  renderSkillText,
  SKILL_GUARD,
  typedSkill,
} from '../../../electron/shared/skill-render';

const SOURCE = 'Call {{tool:ledger_ask}}, then {{skill:plan}} from "{{plugin_root}}/x".';

describe('fillPlaceholders', () => {
  it('fills Claude Code', () => {
    expect(fillPlaceholders(SOURCE, 'claude-code')).toBe(
      'Call mcp__hive__ledger_ask, then hive:plan from "$CLAUDE_PLUGIN_ROOT/x".',
    );
  });
  it('fills Codex, with its folder as the plugin root', () => {
    expect(fillPlaceholders(SOURCE, 'codex', '/ud/hive/plugins/codex')).toBe(
      'Call mcp__hive__ledger_ask, then $hive-plan from "/ud/hive/plugins/codex/x".',
    );
  });
  it('fills Copilot, with its folder as the plugin root', () => {
    expect(fillPlaceholders(SOURCE, 'copilot', '/ud/hive/plugins/copilot')).toBe(
      'Call hive-ledger_ask, then /hive:hive-plan from "/ud/hive/plugins/copilot/x".',
    );
  });
  it('leaves {{plugin_root}} alone for Codex and Copilot when no folder is known, rather than name an unset variable', () => {
    expect(fillPlaceholders('{{plugin_root}}/x', 'codex')).toBe('{{plugin_root}}/x');
    expect(fillPlaceholders('{{plugin_root}}/x', 'copilot')).toBe('{{plugin_root}}/x');
  });
  it('ignores the folder for Claude Code, whose variable is set', () => {
    expect(fillPlaceholders('{{plugin_root}}/x', 'claude-code', '/elsewhere')).toBe('$CLAUDE_PLUGIN_ROOT/x');
  });
  it('leaves text without placeholders exactly as it is', () => {
    const text = 'Use mcp__hive__x and {{ other }} and {{tool:Bad Name}}.';
    expect(fillPlaceholders(text, 'copilot')).toBe(text);
  });
});

describe('typedSkill', () => {
  it('types each CLI its own way', () => {
    expect(typedSkill('hive:work-on', 'claude-code')).toBe('/hive:work-on');
    expect(typedSkill('hive:work-on', 'codex')).toBe('$hive-work-on');
    expect(typedSkill('hive:work-on', 'copilot')).toBe('/hive:hive-work-on');
  });
  it('keeps a name outside hive as stored', () => {
    expect(typedSkill('graphify', 'claude-code')).toBe('/graphify');
    expect(typedSkill('graphify', 'codex')).toBe('$graphify');
    expect(typedSkill('graphify', 'copilot')).toBe('/graphify');
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
  it('leaves Claude Code its frontmatter whole', () => {
    expect(renderSkillText(GOAL, 'claude-code')).toBe(GOAL.replace('{{skill:plan}}', 'hive:plan'));
  });
  it('drops hooks: (blank lines included) and allowed-tools for Codex', () => {
    expect(renderSkillText(GOAL, 'codex')).toBe(
      [
        '---',
        'name: hive-goal-on',
        'description: holds a session',
        'requires: [stop-hook]',
        '---',
        '',
        'Body names $hive-plan.',
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
    expect(renderSkillText(text, 'copilot')).toBe(text);
  });
  it('names a Copilot skill hive-<name>, which no repository skill can hide (HIVE-382)', () => {
    expect(renderSkillText('---\nname: work-on\ndescription: d\n---\nname: prose\n', 'copilot')).toBe(
      '---\nname: hive-work-on\ndescription: d\n---\nname: prose\n',
    );
    expect(renderSkillText('---\nname: "work-on"\n---\n', 'copilot')).toBe('---\nname: hive-work-on\n---\n');
    expect(renderSkillText("---\nname: 'work-on'  \n---\n", 'copilot')).toBe('---\nname: hive-work-on\n---\n');
  });
  it('names a Codex skill hive-<name> too, as its catalog does (HIVE-384)', () => {
    expect(renderSkillText('---\nname: work-on\n---\n', 'codex')).toBe('---\nname: hive-work-on\n---\n');
  });
  it('keeps the bare name for Claude Code, whose plugin namespaces it (HIVE-382)', () => {
    const text = '---\nname: work-on\n---\n';
    expect(renderSkillText(text, 'claude-code')).toBe(text);
  });
});

describe('dropKeysFor', () => {
  it('keeps Claude-only keys for Claude Code', () => {
    expect(dropKeysFor('claude-code')).toEqual([]);
    expect(dropKeysFor('copilot')).toEqual(['hooks', 'allowed-tools']);
  });
});

const KNOWN = { tools: ['ledger_ask', 'jira_get'], skills: ['plan', 'done'] };

describe('makePortable', () => {
  it('keeps the slash when it rewrites /hive:x', () => {
    expect(makePortable('Run /hive:plan now.', KNOWN)).toBe('Run /{{skill:plan}} now.');
  });
  it('does not match inside a longer word', () => {
    expect(makePortable('see foohive:plan and my-hive:plan', KNOWN)).toBe('see foohive:plan and my-hive:plan');
  });
  it('flags nothing mid-word either', () => {
    expect(portabilityIssues('see foohive:plan', KNOWN)).toEqual([]);
  });
});

describe('portabilityIssues', () => {
  it('flags every CLI-specific literal with its fix', () => {
    const text = [
      'Call mcp__hive__ledger_ask first.',
      'Copilot calls hive-jira_get.',
      'Then run `hive:plan` or /hive:plan.',
      'node "$CLAUDE_PLUGIN_ROOT/x.mjs"',
    ].join('\n');
    expect(portabilityIssues(text, KNOWN)).toEqual([
      {
        line: 1,
        found: 'mcp__hive__ledger_ask',
        fix: '{{tool:ledger_ask}}',
        message: '`mcp__hive__ledger_ask` only works in Claude Code and Codex. Write `{{tool:ledger_ask}}`.',
      },
      {
        line: 2,
        found: 'hive-jira_get',
        fix: '{{tool:jira_get}}',
        message: '`hive-jira_get` only works in Copilot. Write `{{tool:jira_get}}`.',
      },
      {
        line: 3,
        found: 'hive:plan',
        fix: '{{skill:plan}}',
        message: '`hive:plan` only works in Claude Code. Write `{{skill:plan}}`.',
      },
      {
        line: 3,
        found: 'hive:plan',
        fix: '{{skill:plan}}',
        message: '`hive:plan` only works in Claude Code. Write `{{skill:plan}}`.',
      },
      {
        line: 4,
        found: '$CLAUDE_PLUGIN_ROOT',
        fix: '{{plugin_root}}',
        message: '`$CLAUDE_PLUGIN_ROOT` is only set in Claude Code. Write `{{plugin_root}}`.',
      },
    ]);
  });

  it('names a placeholder that points nowhere', () => {
    expect(portabilityIssues('{{tool:ledger_asks}} then {{skill:plann}}', KNOWN)).toEqual([
      { line: 1, found: '{{tool:ledger_asks}}', fix: null, message: 'No hive tool is called `ledger_asks`.' },
      { line: 1, found: '{{skill:plann}}', fix: null, message: 'No skill is called `plann`.' },
    ]);
  });

  it('leaves alone what it cannot be sure of', () => {
    const text =
      'Run /plan or $plan; hive-unknown_tool; hive:other-plugin; {{tool:ledger_ask}} {{skill:plan}} {{plugin_root}}';
    expect(portabilityIssues(text, KNOWN)).toEqual([]);
  });
});

describe('makePortable', () => {
  it('rewrites every fixable literal and nothing else', () => {
    const text =
      'mcp__hive__ledger_ask, hive-jira_get, `hive:plan`, /hive:plan, $CLAUDE_PLUGIN_ROOT, {{skill:plann}}, /plan';
    expect(makePortable(text, KNOWN)).toBe(
      '{{tool:ledger_ask}}, {{tool:jira_get}}, `{{skill:plan}}`, /{{skill:plan}}, {{plugin_root}}, {{skill:plann}}, /plan',
    );
  });
  it('is a fixed point on portable text', () => {
    const text = makePortable('mcp__hive__ledger_ask', KNOWN);
    expect(makePortable(text, KNOWN)).toBe(text);
    expect(portabilityIssues(text, KNOWN)).toEqual([]);
  });
});

describe('guardSkill (HIVE-372)', () => {
  it('goes right after the frontmatter', () => {
    expect(guardSkill('---\nname: hive-x\ndescription: d\n---\n# X\nbody\n')).toBe(
      `---\nname: hive-x\ndescription: d\n---\n\n${SKILL_GUARD}\n\n# X\nbody\n`,
    );
  });
  it('goes first when there is no frontmatter, or it never closes', () => {
    expect(guardSkill('# X\n')).toBe(`${SKILL_GUARD}\n\n# X\n`);
    expect(guardSkill('---\nname: x\n')).toBe(`${SKILL_GUARD}\n\n---\nname: x\n`);
  });
  it('names the variable and the sentence the ticket fixed', () => {
    expect(SKILL_GUARD).toContain('HIVE_RECEIVER_URL');
    expect(SKILL_GUARD).toContain('this skill needs a HiveTTY session');
  });
});
