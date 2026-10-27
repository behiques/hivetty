import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { decide } from '@shared/permission-rules';

import {
  COPILOT_RULE_TABLE,
  copilotFenceReply,
  readCopilotFence,
  translateCopilotCall,
} from '../../../../../electron/main/harness/copilot/fence';
import type { FenceCall } from '../../../../../electron/main/harness/port';

const FIX = join(__dirname, '../../../../fixtures/copilot');
const fx = (name: string) =>
  JSON.parse(readFileSync(join(FIX, `hooks-1.0.104/${name}.json`), 'utf8')) as {
    toolName: string;
    toolArgs: Record<string, unknown>;
    cwd: string;
  };
const call = (name: string) => {
  const body = fx(name);
  return translateCopilotCall(body.toolName, body.toolArgs, body.cwd);
};

const WD = '/tmp/copilot-fixture/wd';

describe('translateCopilotCall', () => {
  it('reads the four probed kinds as Claude would name them', () => {
    expect(call('pre-tool-use-bash')).toEqual([{ tool: 'Bash', input: { command: 'echo probe-ok' } }]);
    expect(call('pre-tool-use-create')).toEqual([
      { tool: 'Write', input: { file_path: `${WD}/made.txt` } },
    ]);
    expect(call('pre-tool-use-mcp')).toEqual([{ tool: 'probe-envcheck', input: {} }]); // not hive: raw
    expect(translateCopilotCall('hive-ledger_read', { limit: 5 }, '/w')).toEqual([
      { tool: 'mcp__hive__ledger_read', input: { limit: 5 } },
    ]);
    expect(call('pre-tool-use-task')[0]!.tool).toBe('Task');
  });

  it('reads the recorded read-side calls as Claude would name them', () => {
    expect(call('pre-tool-use-view')).toEqual([{ tool: 'Read', input: { file_path: `${WD}/a.txt` } }]);
    expect(call('pre-tool-use-edit')).toEqual([{ tool: 'Edit', input: { file_path: `${WD}/a.txt` } }]);
    expect(call('pre-tool-use-glob')).toEqual([{ tool: 'Glob', input: { pattern: '*.txt' } }]);
    expect(call('pre-tool-use-grep')).toEqual([
      { tool: 'Grep', input: { pattern: 'bye', output_mode: 'content', '-n': true } },
    ]);
    expect(call('pre-tool-use-web-fetch')).toEqual([
      { tool: 'WebFetch', input: { url: 'https://example.com' } },
    ]);
  });

  it('joins a relative path to the cwd and never normalises it', () => {
    expect(translateCopilotCall('create', { path: '../x/.env', file_text: '' }, '/w/a')).toEqual([
      { tool: 'Write', input: { file_path: '/w/a/../x/.env' } },
    ]);
    expect(translateCopilotCall('view', { path: 'b.txt' }, '/w/a/')).toEqual([
      { tool: 'Read', input: { file_path: '/w/a/b.txt' } },
    ]);
    const edit = translateCopilotCall('edit', { path: '../.ssh/k', old_str: 'a', new_str: 'b' }, '/w');
    expect(edit).toEqual([{ tool: 'Edit', input: { file_path: '/w/../.ssh/k' } }]);
    expect(decide('Edit', edit[0]!.input, ['Edit(/w/**)'])).toEqual({ behavior: 'ask' });
  });

  it('passes an unknown tool through raw, which decide denies', () => {
    expect(translateCopilotCall('mystery', { a: 1 }, '/w')).toEqual([{ tool: 'mystery', input: { a: 1 } }]);
    // `*` grants every name by definition; any narrower grant set leaves an unknown name to be asked.
    expect(decide('mystery', {}, ['Read', 'Bash', 'Write(/w/**)', 'mcp__hive__*']).behavior).not.toBe(
      'allow',
    );
  });

  it('passes a known name with no readable argument through raw', () => {
    for (const [tool, input] of [
      ['bash', { command: 1 }],
      ['create', {}],
      ['edit', { file_path: 3 }],
      ['view', {}],
      ['web_fetch', { url: 7 }],
    ] as const) {
      expect(translateCopilotCall(tool, input, '/w')).toEqual([{ tool, input }]);
    }
  });
});

/** The shape of one rule in Claude's grammar, the name `COPILOT_RULE_TABLE` files it under. */
const shapeOf = (rule: string): string => {
  if (rule === '*') return '*';
  const literal = /^literal:([^:]+):/.exec(rule);
  if (literal !== null) {
    return `literal:${literal[1]!.startsWith('mcp__') ? 'mcp__<server>__<tool>' : literal[1]}:<text>`;
  }
  if (rule.startsWith('mcp__')) return rule.endsWith('*') ? 'mcp__<server>__*' : 'mcp__<server>__<tool>';
  const named = /^([A-Za-z]+)\((.+)\)$/.exec(rule);
  if (named !== null) return named[1] === 'WebFetch' ? 'WebFetch(domain:<d>)' : `${named[1]}(<glob>)`;
  if (/^[A-Za-z]+$/.test(rule)) return rule;
  return '<malformed>';
};

/** Each expressed shape, as concrete rules: one that names the fixture call and one that does not. */
const INSTANCES: Record<string, readonly string[]> = {
  '*': ['*'],
  Bash: ['Bash'],
  'Bash(<glob>)': ['Bash(echo *)', 'Bash(git *)'],
  Write: ['Write'],
  'Write(<glob>)': ['Write(/tmp/copilot-fixture/**)', 'Write(/elsewhere/**)'],
  Edit: ['Edit'],
  'Edit(<glob>)': ['Edit(/tmp/copilot-fixture/wd/*)', 'Edit(/x/**)'],
  Read: ['Read'],
  'Read(<glob>)': ['Read(/tmp/copilot-fixture/**)', 'Read(/etc/**)'],
  Glob: ['Glob'],
  Grep: ['Grep'],
  WebFetch: ['WebFetch'],
  'WebFetch(domain:<d>)': ['WebFetch(domain:example.com)', 'WebFetch(domain:github.com)', 'WebFetch(domain:*)'],
  Task: ['Task'],
  'mcp__<server>__<tool>': ['mcp__hive__ledger_read', 'mcp__probe__envcheck'],
  'mcp__<server>__*': ['mcp__hive__*', 'mcp__probe__*'],
  'literal:Bash:<text>': ['literal:Bash:echo probe-ok', 'literal:Bash:echo other'],
  'literal:Write:<text>': [`literal:Write:${WD}/made.txt`],
  'literal:Edit:<text>': [`literal:Edit:${WD}/a.txt`],
  'literal:Read:<text>': [`literal:Read:${WD}/a.txt`, 'literal:Read:/repo/../etc/passwd'],
  'literal:Grep:<text>': ['literal:Grep:bye'],
  'literal:WebFetch:<text>': ['literal:WebFetch:domain:example.com', 'literal:WebFetch:domain:github.com'],
  'literal:mcp__<server>__<tool>:<text>': ['literal:mcp__hive__ledger_read:x'],
  '<malformed>': ['', 'Bash(', 'literal:', 'literal:Bash'],
};

/** Each recorded Copilot call, beside the Claude call it names (written out, not derived). */
const NAMED: readonly { copilot: FenceCall & { cwd: string }; claude: FenceCall }[] = [
  ...(
    [
      ['pre-tool-use-bash', { tool: 'Bash', input: { command: 'echo probe-ok' } }],
      ['pre-tool-use-subagent', { tool: 'Bash', input: { command: 'echo from-sub' } }],
      ['pre-tool-use-create', { tool: 'Write', input: { file_path: `${WD}/made.txt` } }],
      ['pre-tool-use-mcp', { tool: 'mcp__probe__envcheck', input: {} }],
      ['pre-tool-use-task', { tool: 'Task', input: {} }],
      ['pre-tool-use-view', { tool: 'Read', input: { file_path: `${WD}/a.txt` } }],
      ['pre-tool-use-edit', { tool: 'Edit', input: { file_path: `${WD}/a.txt` } }],
      ['pre-tool-use-glob', { tool: 'Glob', input: { pattern: '*.txt' } }],
      ['pre-tool-use-grep', { tool: 'Grep', input: { pattern: 'bye' } }],
      ['pre-tool-use-web-fetch', { tool: 'WebFetch', input: { url: 'https://example.com' } }],
    ] as const
  ).map(([name, claude]) => {
    const body = fx(name);
    return { copilot: { tool: body.toolName, input: body.toolArgs, cwd: body.cwd }, claude };
  }),
  {
    copilot: { tool: 'hive-ledger_read', input: { limit: 5 }, cwd: '/w' },
    claude: { tool: 'mcp__hive__ledger_read', input: { limit: 5 } },
  },
  {
    copilot: { tool: 'create', input: { path: '../wd/made.txt', file_text: '' }, cwd: WD },
    claude: { tool: 'Write', input: { file_path: `${WD}/../wd/made.txt` } },
  },
];

describe('the translated call, against decide', () => {
  it('instantiates every expressed shape with rules of that shape', () => {
    for (const shape of COPILOT_RULE_TABLE.expressed) {
      const rules = INSTANCES[shape] ?? [];
      expect(rules.length, shape).toBeGreaterThan(0);
      for (const rule of rules) expect(shapeOf(rule), rule).toBe(shape);
    }
  });

  it('a translated call is never allowed where the Claude rule denies it', () => {
    const allowed = (calls: readonly FenceCall[], grants: readonly string[]) =>
      calls.every((one) => decide(one.tool, one.input, grants).behavior === 'allow');
    let allowedSome = 0;
    for (const { copilot, claude } of NAMED) {
      const translated = translateCopilotCall(copilot.tool, copilot.input, copilot.cwd);
      for (const shape of COPILOT_RULE_TABLE.expressed) {
        for (const rule of INSTANCES[shape] ?? []) {
          if (!allowed(translated, [rule])) continue;
          allowedSome += 1;
          expect(allowed([claude], [rule]), `${copilot.tool} under ${rule}`).toBe(true);
        }
      }
    }
    // The check is not vacuous: rules do allow translated calls.
    expect(allowedSome).toBeGreaterThan(NAMED.length);
  });
});

describe('COPILOT_RULE_TABLE', () => {
  const source = readFileSync(join(__dirname, '../../../shared/permission-rules.test.ts'), 'utf8');
  const rules = [...source.matchAll(/matches\(\s*'([^']*)'/g)].map((match) => match[1]!);

  it('files every rule shape from permission-rules.test.ts under exactly one list', () => {
    expect(rules.length).toBeGreaterThan(10);
    const expressed: readonly string[] = COPILOT_RULE_TABLE.expressed;
    const neverProduced: readonly string[] = COPILOT_RULE_TABLE.neverProduced;
    for (const rule of rules) {
      const shape = shapeOf(rule);
      expect(expressed.includes(shape) !== neverProduced.includes(shape), `${rule} → ${shape}`).toBe(
        true,
      );
    }
    expect(expressed.filter((shape) => neverProduced.includes(shape))).toEqual([]);
    expect(neverProduced).toEqual(['NotebookEdit', 'Agent']);
  });
});

describe('readCopilotFence and copilotFenceReply', () => {
  it('reads the body and answers in copilot shape', () => {
    expect(readCopilotFence(fx('pre-tool-use-bash'))).toEqual({
      tool: 'bash',
      input: { command: 'echo probe-ok', description: 'Echo probe-ok' },
      cwd: WD,
    });
    expect(readCopilotFence({ toolName: 'bash', toolArgs: '{"command":"ls"}', cwd: '/w' })!.input).toEqual({
      command: 'ls',
    });
    expect(readCopilotFence({ toolArgs: {} })).toBeNull();
    expect(copilotFenceReply()).toEqual({});
    expect(copilotFenceReply('no')).toEqual({ permissionDecision: 'deny', permissionDecisionReason: 'no' });
  });

  it('refuses unreadable args and reads anything that is not an object as empty', () => {
    expect(readCopilotFence({ toolName: 'bash', toolArgs: '{nope' })).toBeNull();
    expect(readCopilotFence({ toolName: 'bash', toolArgs: [1] })).toEqual({ tool: 'bash', input: {}, cwd: '' });
    expect(readCopilotFence({ toolName: 'bash' })).toEqual({ tool: 'bash', input: {}, cwd: '' });
  });
});
