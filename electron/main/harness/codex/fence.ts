import { isAbsolute } from 'node:path';

import type { FenceCall, PermissionFence } from '../port';

const HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/;

/**
 * Every file a patch touches, as Claude's Write/Edit; `null` when it is not a patch we can read.
 * A relative path is joined to `cwd` and never normalised: `decide` refuses a `..` segment rather
 * than resolving it, and `path.join` would turn `/w/a/../x` into `/w/x`, which a grant can allow.
 */
export function patchTargets(patch: string, cwd: string): FenceCall[] | null {
  const lines = patch.split('\n');
  if (lines[0]?.trim() !== '*** Begin Patch') return null;
  const at = (path: string) => (isAbsolute(path) ? path : `${cwd.replace(/\/+$/, '')}/${path}`);
  const calls: FenceCall[] = [];
  for (const line of lines) {
    const match = HEADER.exec(line.trim());
    if (match === null) continue;
    const [, op, path, moved] = match;
    if (moved !== undefined) calls.push({ tool: 'Edit', input: { file_path: at(moved) } });
    else if (path !== undefined) {
      calls.push({ tool: op === 'Update' ? 'Edit' : 'Write', input: { file_path: at(path) } });
    }
  }
  return calls.length === 0 ? null : calls;
}

/** One Codex call as `decide` reads it: a patch becomes its files, anything else passes through. */
export function translateCodexCall(
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
): FenceCall[] {
  if (tool === 'apply_patch' && typeof input['command'] === 'string') {
    return patchTargets(input['command'], cwd) ?? [{ tool, input }];
  }
  return [{ tool, input }];
}

/**
 * Each rule shape in Claude's grammar, and what it governs on Codex (doc table, and a test).
 * `expressed`: `decide` meets it on a translated call. `neverProduced`: Codex makes no call by that
 * name (it reads and searches through the shell), so the rule allows nothing and widens nothing.
 */
export const CODEX_RULE_TABLE = {
  expressed: [
    '*',
    'Bash',
    'Bash(<glob>)',
    'Write',
    'Write(<glob>)',
    'Edit',
    'Edit(<glob>)',
    'mcp__<server>__<tool>',
    'mcp__<server>__*',
    'literal:Bash:<text>',
    'literal:Write:<text>',
    'literal:Edit:<text>',
    'literal:mcp__<server>__<tool>:<text>',
    '<malformed>',
  ],
  neverProduced: [
    'Read',
    'Read(<glob>)',
    'Glob',
    'Grep',
    'WebFetch',
    'WebFetch(domain:<d>)',
    'NotebookEdit',
    'Task',
    'Agent',
    'literal:Read:<text>',
    'literal:Grep:<text>',
    'literal:WebFetch:<text>',
  ],
} as const;

/** Total: every rule is enforced by `decide` on the translated calls (HIVE-342). */
export const codexFence: PermissionFence = {
  express: () => ({ ok: true }),
  translate: translateCodexCall,
};
