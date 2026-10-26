import { isAbsolute } from 'node:path';

import type { FenceCall, PermissionFence } from '../port';

const HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to): ([^]*)$/;
const MARKER = /^\*\*\* (?:End of File|End Patch)$/;
/** What `trim` strips, plus the U+0085 Rust's `trim` also strips: a header codex sees is one this sees. */
const SPACE = /^[\s\u0085]$/;
/** Both edges trimmed in one pass: a `/[\s]+$/` regex backtracks quadratically on a long run of spaces. */
const trimEdges = (line: string): string => {
  let start = 0;
  let end = line.length;
  while (start < end && SPACE.test(line[start]!)) start += 1;
  while (end > start && SPACE.test(line[end - 1]!)) end -= 1;
  return line.slice(start, end);
};
const INDENT = /^[\s\u0085]+/;
/** A path codex would write that a `.`-based reader would cut short, or that only differs by a blank. */
const unsafePath = (path: string): boolean =>
  /^\s|\s$/.test(path) ||
  [...path].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029;
  });

/**
 * Every file a patch touches, as Claude's Write/Edit; `null` when it is not a patch we can read, so
 * the whole patch is asked about. Strict on purpose: any `***` line that is not a header this knows,
 * a path holding a control or line-separator character, a `Move to` with no file before it, or
 * anything after `*** End Patch` gives `null`, because a header skipped here is a file written
 * unchecked.
 *
 * A relative path is joined to `cwd` and never normalised: `decide` refuses a `..` segment rather
 * than resolving it, and `path.join` would turn `/w/a/../x` into `/w/x`, which a grant can allow.
 */
export function patchTargets(patch: string, cwd: string): FenceCall[] | null {
  if (!isAbsolute(cwd)) return null;
  // Codex splits on `\n` and drops one trailing `\r` (Rust's `lines`), nothing else.
  const lines = patch.split('\n').map((line) => line.replace(/\r$/, ''));
  if (trimEdges(lines[0] ?? '') !== '*** Begin Patch') return null;
  const at = (path: string) => (isAbsolute(path) ? path : `${cwd.replace(/\/+$/, '')}/${path}`);
  const calls: FenceCall[] = [];
  let updating = false;
  let ended = false;
  for (const line of lines.slice(1)) {
    if (ended) {
      if (trimEdges(line) !== '') return null;
      continue;
    }
    // Only the indent: a trailing blank stays on the path, where `unsafePath` refuses it.
    const text = line.replace(INDENT, '');
    if (!text.startsWith('***')) continue;
    if (MARKER.test(text)) {
      ended = text === '*** End Patch';
      continue;
    }
    const match = HEADER.exec(text);
    if (match === null) return null;
    const [, op, path] = match as unknown as [string, string, string];
    if (path === '' || unsafePath(path)) return null;
    if (op === 'Move to' && !updating) return null;
    updating = op === 'Update File';
    calls.push({ tool: op === 'Add File' || op === 'Delete File' ? 'Write' : 'Edit', input: { file_path: at(path) } });
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

/**
 * Total (HIVE-342): every rule is enforced by `decide` on the translated calls, through the
 * PreToolUse hook `launchCodexHeadless` puts on every wake (`fenceCommand`) and the receiver's
 * `/fence` route.
 */
export const codexFence: PermissionFence = {
  express: () => ({ ok: true }),
  translate: translateCodexCall,
};
