import { isAbsolute } from 'node:path';

import type { FenceCall } from '../port';

/**
 * A relative path joined to the cwd and never normalised: `decide` refuses a `..` rather than
 * resolving it. `undefined` when the path is relative and the cwd is not absolute, as Codex's
 * `patchTargets` does: a path joined to `''` would read as rooted somewhere it does not land.
 */
const at = (path: string, cwd: string): string | undefined => {
  if (isAbsolute(path)) return path;
  return isAbsolute(cwd) ? `${cwd.replace(/\/+$/, '')}/${path}` : undefined;
};
/** An empty string is no value, as `decide` reads one. */
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
/** `hive-<tool>`: a hive tool name holds no `-`, so `hive-extra-foo` is another server's. */
const HIVE_TOOL = /^hive-([A-Za-z0-9_]+)$/;

/** Copilot's path tools, and the Claude tool each one is (probed at 1.0.104). */
const PATH_TOOLS: Record<string, string> = { create: 'Write', edit: 'Edit', view: 'Read' };

/**
 * One Copilot call as `decide` reads it (HIVE-343). Only names a probe recorded are translated
 * (`tests/fixtures/copilot/hooks-1.0.104/`); anything else passes raw, and `decide` meets a name it
 * does not know. Never a matcher of its own.
 */
export function translateCopilotCall(
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
): FenceCall[] {
  const raw = str(input['path']) ?? str(input['file_path']);
  const path = raw === undefined ? undefined : at(raw, cwd);
  const pathTool = Object.hasOwn(PATH_TOOLS, tool) ? PATH_TOOLS[tool] : undefined;
  const command = str(input['command']);
  const url = str(input['url']);
  if (tool === 'bash' && command !== undefined) return [{ tool: 'Bash', input: { command } }];
  if (pathTool !== undefined && path !== undefined) {
    return [{ tool: pathTool, input: { file_path: path } }];
  }
  if (tool === 'glob') return [{ tool: 'Glob', input }];
  if (tool === 'grep') return [{ tool: 'Grep', input }];
  if (tool === 'web_fetch' && url !== undefined) return [{ tool: 'WebFetch', input: { url } }];
  if (tool === 'task') return [{ tool: 'Task', input }];
  // Copilot's search for a deferred tool's schema; `decide` reads no input of `ToolSearch`'s.
  if (tool === 'tool_search_tool') return [{ tool: 'ToolSearch', input }];
  const hive = HIVE_TOOL.exec(tool);
  if (hive !== null) return [{ tool: `mcp__hive__${hive[1]!}`, input }];
  return [{ tool, input }];
}

/** A `preToolUse` body: the call and its cwd, or `null` when it names no tool or its args do not parse. */
export function readCopilotFence(
  body: Record<string, unknown>,
): { tool: string; input: Record<string, unknown>; cwd: string } | null {
  const tool = body['toolName'];
  if (typeof tool !== 'string') return null;
  let args: unknown = body['toolArgs'];
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  const input =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  return { tool, input, cwd: typeof body['cwd'] === 'string' ? body['cwd'] : '' };
}

/** Copilot's `preToolUse` reply (probed): `{}` leaves the call to `--allow-tool`, a deny carries the reason. */
export const copilotFenceReply = (reason?: string): Record<string, unknown> =>
  reason === undefined ? {} : { permissionDecision: 'deny', permissionDecisionReason: reason };

/**
 * Each rule shape in Claude's grammar, and what it governs on Copilot (doc table, and a test).
 * `expressed`: `decide` meets it on a translated call (bash, create, edit, view, glob, grep,
 * web_fetch, task, tool_search_tool and `hive-*` were all recorded). `neverProduced`: Copilot
 * makes no call by that name, so the rule allows nothing and widens nothing.
 */
export const COPILOT_RULE_TABLE = {
  expressed: [
    '*',
    'Bash',
    'Bash(<glob>)',
    'Write',
    'Write(<glob>)',
    'Edit',
    'Edit(<glob>)',
    'Read',
    'Read(<glob>)',
    'Glob',
    'Grep',
    'WebFetch',
    'WebFetch(domain:<d>)',
    'Task',
    'ToolSearch',
    'mcp__<server>__<tool>',
    'mcp__<server>__*',
    'literal:Bash:<text>',
    'literal:Write:<text>',
    'literal:Edit:<text>',
    'literal:Read:<text>',
    'literal:Grep:<text>',
    'literal:WebFetch:<text>',
    'literal:mcp__<server>__<tool>:<text>',
    '<malformed>',
  ],
  neverProduced: ['NotebookEdit', 'Agent'],
} as const;
