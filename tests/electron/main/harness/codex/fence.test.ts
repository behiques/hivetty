import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { decide } from '@shared/permission-rules';

import {
  CODEX_RULE_TABLE,
  codexFence,
  translateCodexCall,
} from '../../../../../electron/main/harness/codex/fence';
import type { FenceCall } from '../../../../../electron/main/harness/port';

describe('translateCodexCall', () => {
  it('passes Bash and MCP calls through unchanged', () => {
    expect(translateCodexCall('Bash', { command: 'git status' }, '/w')).toEqual([
      { tool: 'Bash', input: { command: 'git status' } },
    ]);
    expect(translateCodexCall('mcp__hive__ledger_read', {}, '/w')).toEqual([
      { tool: 'mcp__hive__ledger_read', input: {} },
    ]);
  });

  it('turns a patch into one Write or Edit per file, resolved against cwd', () => {
    const patch =
      '*** Begin Patch\n*** Add File: a.txt\n+x\n*** Update File: /abs/b.ts\n@@\n-y\n+z\n*** Delete File: c\n*** Update File: d\n*** Move to: e\n*** End Patch';
    expect(translateCodexCall('apply_patch', { command: patch }, '/w')).toEqual([
      { tool: 'Write', input: { file_path: '/w/a.txt' } },
      { tool: 'Edit', input: { file_path: '/abs/b.ts' } },
      { tool: 'Write', input: { file_path: '/w/c' } },
      { tool: 'Edit', input: { file_path: '/w/d' } },
      { tool: 'Edit', input: { file_path: '/w/e' } },
    ]);
  });

  it('reads the recorded patch from codex 0.164.0', () => {
    const lines = readFileSync(
      join(__dirname, '../../../../fixtures/codex/hooks-0.164.0.jsonl'),
      'utf8',
    )
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const patch = lines.find((line) => line['tool_name'] === 'apply_patch');
    expect(
      translateCodexCall('apply_patch', patch?.['tool_input'] as Record<string, unknown>, '/w'),
    ).toEqual([{ tool: 'Write', input: { file_path: '/w/note.txt' } }]);
  });

  it('asks about a patch it cannot read rather than guessing', () => {
    expect(translateCodexCall('apply_patch', { command: 'garbage' }, '/w')).toEqual([
      { tool: 'apply_patch', input: { command: 'garbage' } },
    ]);
    const empty = '*** Begin Patch\n*** End Patch';
    expect(translateCodexCall('apply_patch', { command: empty }, '/w')).toEqual([
      { tool: 'apply_patch', input: { command: empty } },
    ]);
    expect(translateCodexCall('apply_patch', { patch: 'x' }, '/w')).toEqual([
      { tool: 'apply_patch', input: { patch: 'x' } },
    ]);
  });

  it('keeps ../ in the path so decide refuses the walk-up as it does for Claude', () => {
    const calls = translateCodexCall(
      'apply_patch',
      { command: '*** Begin Patch\n*** Add File: ../x\n+y\n*** End Patch' },
      '/w/a',
    );
    expect(calls).toEqual([{ tool: 'Write', input: { file_path: '/w/a/../x' } }]);
    // A grant covering where the walk-up lands still does not allow it: it is asked about.
    expect(decide('Write', calls[0]!.input, ['Write(/w/**)'])).toEqual({ behavior: 'ask' });
  });

  it('never lets an Update File header hide a second file in the body', () => {
    const patch =
      '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+*** Add File: /etc/evil\n*** End Patch';
    expect(translateCodexCall('apply_patch', { command: patch }, '/w')).toEqual([
      { tool: 'Edit', input: { file_path: '/w/src/a.ts' } },
    ]);
  });

  it('asks about the whole patch when any header is not one it can read', () => {
    const wrap = (...lines: string[]) =>
      ['*** Begin Patch', '*** Add File: src/ok.ts', '+x', ...lines, '*** End Patch'].join('\n');
    for (const patch of [
      // a path codex reads to the end of the line, which `.` would stop short of
      wrap('*** Add File: /etc/x\u2029y', '+y'),
      wrap('*** Add File: /etc/x\u2028y', '+y'),
      wrap('*** Add File: /etc/x\ry', '+y'),
      wrap('*** Add File: /etc/x\u0085y', '+y'),
      wrap('*** Delete File: /etc/x\u0000'),
      // a header this reader does not know
      wrap('*** Frobnicate File: /etc/x'),
      wrap('*** add file: /etc/x', '+y'),
      wrap('***\tAdd File: /etc/x', '+y'),
      wrap('*** Add File:  /etc/x', '+y'),
      wrap('*** Add File: '),
      wrap('*** Delete File: b '),
      // a move with no file to move
      wrap('*** Move to: /etc/x'),
      // a second patch, or anything after the end
      ['*** Begin Patch', '*** End Patch', '*** Add File: /etc/x', '+y'].join('\n'),
      wrap('*** Begin Patch'),
    ]) {
      expect(translateCodexCall('apply_patch', { command: patch }, '/w'), JSON.stringify(patch)).toEqual([
        { tool: 'apply_patch', input: { command: patch } },
      ]);
    }
  });

  it('asks about a patch whose cwd is not absolute', () => {
    const patch = '*** Begin Patch\n*** Add File: a\n+x\n*** End Patch';
    for (const cwd of ['', 'w', './w']) {
      expect(translateCodexCall('apply_patch', { command: patch }, cwd)).toEqual([
        { tool: 'apply_patch', input: { command: patch } },
      ]);
    }
  });

  it('reads a CRLF patch as codex does, and an indented header', () => {
    const patch =
      '*** Begin Patch\r\n*** Add File: a.txt\r\n+x\r\n  *** Delete File: b\r\n*** End Patch\r\n';
    expect(translateCodexCall('apply_patch', { command: patch }, '/w')).toEqual([
      { tool: 'Write', input: { file_path: '/w/a.txt' } },
      { tool: 'Write', input: { file_path: '/w/b' } },
    ]);
  });
});

/** mulberry32: a seeded PRNG, so a failing case reproduces. */
const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('the translated patch, against decide', () => {
  const PATHS = ['src/a.ts', 'src/b/c.ts', '../x', '/etc/passwd', 'docs/d.md'];
  const GRANTS = ['Write(/w/src/**)', 'Edit(/w/src/**)', 'Edit(/w/docs/**)', 'Write', 'Bash(git status:*)'];
  const OPS = ['add', 'update', 'delete', 'move'] as const;
  const at = (path: string) => (path.startsWith('/') ? path : `/w/${path}`);

  it('allows a patch exactly when every file it touches would be allowed (500 seeded cases)', () => {
    const random = mulberry32(342);
    const pick = <T>(from: readonly T[]): T => from[Math.floor(random() * from.length)]!;
    for (let n = 0; n < 500; n += 1) {
      const files = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
        op: pick(OPS),
        path: pick(PATHS),
        to: pick(PATHS),
      }));
      const grants = GRANTS.filter(() => random() < 0.4);
      const body = files.flatMap((file) =>
        file.op === 'add'
          ? [`*** Add File: ${file.path}`, '+x']
          : file.op === 'delete'
            ? [`*** Delete File: ${file.path}`]
            : file.op === 'update'
              ? [`*** Update File: ${file.path}`, '@@', '-a', '+b']
              : [`*** Update File: ${file.path}`, `*** Move to: ${file.to}`, '@@', '-a', '+b'],
      );
      const patch = ['*** Begin Patch', ...body, '*** End Patch'].join('\n');
      const touched = files.flatMap((file): FenceCall[] =>
        file.op === 'add' || file.op === 'delete'
          ? [{ tool: 'Write', input: { file_path: at(file.path) } }]
          : file.op === 'update'
            ? [{ tool: 'Edit', input: { file_path: at(file.path) } }]
            : [
                { tool: 'Edit', input: { file_path: at(file.path) } },
                { tool: 'Edit', input: { file_path: at(file.to) } },
              ],
      );
      const allowed = (calls: FenceCall[]) =>
        calls.every((call) => decide(call.tool, call.input, grants).behavior === 'allow');
      expect(
        allowed(translateCodexCall('apply_patch', { command: patch }, '/w')),
        `${patch}\n${grants.join(' ')}`,
      ).toBe(allowed(touched));
    }
  });
});

/** The shape of one rule in Claude's grammar, the name `CODEX_RULE_TABLE` files it under. */
const shapeOf = (rule: string): string => {
  if (rule === '*') return '*';
  const literal = /^literal:([^:]+):/.exec(rule);
  if (literal !== null) {
    return `literal:${literal[1]!.startsWith('mcp__') ? 'mcp__<server>__<tool>' : literal[1]}:<text>`;
  }
  if (rule.startsWith('mcp__')) return rule.endsWith('*') ? 'mcp__<server>__*' : 'mcp__<server>__<tool>';
  const call = /^([A-Za-z]+)\((.+)\)$/.exec(rule);
  if (call !== null) return call[1] === 'WebFetch' ? 'WebFetch(domain:<d>)' : `${call[1]}(<glob>)`;
  if (/^[A-Za-z]+$/.test(rule)) return rule;
  return '<malformed>';
};

describe('CODEX_RULE_TABLE', () => {
  const source = readFileSync(
    join(__dirname, '../../../shared/permission-rules.test.ts'),
    'utf8',
  );
  const rules = [...source.matchAll(/matches\(\s*'([^']*)'/g)].map((match) => match[1]!);

  it('files every rule shape the rule tests name under exactly one list', () => {
    expect(rules.length).toBeGreaterThan(10);
    const expressed: readonly string[] = CODEX_RULE_TABLE.expressed;
    const neverProduced: readonly string[] = CODEX_RULE_TABLE.neverProduced;
    for (const rule of rules) {
      const shape = shapeOf(rule);
      expect(expressed.includes(shape) !== neverProduced.includes(shape), `${rule} → ${shape}`).toBe(
        true,
      );
    }
    expect(expressed.filter((shape) => neverProduced.includes(shape))).toEqual([]);
  });
});

describe('codexFence', () => {
  it('translates for decide, and still refuses until the PreToolUse hook is on the argv', () => {
    expect(codexFence.express([])).toEqual({ ok: false, unexpressible: ['*'] });
    expect(codexFence.translate).toBe(translateCodexCall);
  });
});
