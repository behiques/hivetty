import { claudeCodeAdapter } from '../claude-code';
import type { HookInput, HookReading } from '../port';

/** Copilot's session events in Claude's spelling (HIVE-280, FINDINGS P0 and P1). */
const CLAUDE_EVENT: Record<string, string> = {
  sessionStart: 'SessionStart',
  userPromptSubmitted: 'UserPromptSubmit',
  permissionRequest: 'PermissionRequest',
  postToolUse: 'PostToolUse',
  agentStop: 'Stop',
};

/**
 * File writes, by one name (FINDINGS P1). `permissionRequest` names the permission kind `edit` for
 * every file tool while `postToolUse` names the tool itself, and the tracker clears a block by name.
 */
const WRITE_TOOLS = new Set(['edit', 'create', 'apply_patch']);

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * A Copilot hook (HIVE-343 agents, HIVE-280 sessions). Copilot's bodies name no event, so the hook
 * command wraps each as `{"event":…,"payload":…}` (`hook-commands.ts`). The body is re-spelled as
 * Claude's and read by Claude's reader, so status, the inbox and the tracker see one shape, as
 * `readCodexHook` does. A subagent's `agentStop` (`agentId` set) never ends its parent's turn.
 * An agent run reads only `agentStop`: its tool calls go through `/fence`.
 */
export function readCopilotHook(input: HookInput): HookReading {
  if (input.lane !== 'agent' && input.lane !== 'session') return { effects: [] };
  if (input.truncated) return { malformed: true, effects: [] };
  let envelope: unknown;
  try {
    envelope = JSON.parse(input.body);
  } catch {
    return { malformed: true, effects: [] };
  }
  const { event, payload } = (envelope ?? {}) as { event?: unknown; payload?: Record<string, unknown> };
  if (typeof event !== 'string' || typeof payload !== 'object' || payload === null) return { effects: [] };
  if (input.lane === 'agent' && event !== 'agentStop') return { effects: [] };
  const name = CLAUDE_EVENT[event];
  if (name === undefined) return { effects: [] };
  if (event === 'agentStop' && payload['agentId'] !== undefined) return { effects: [] };

  const sessionId = text(payload['sessionId']);
  const cwd = text(payload['cwd']);
  const tool = text(payload['toolName']);
  const toolName = tool !== undefined && WRITE_TOOLS.has(tool) ? 'edit' : tool;
  const body =
    input.lane === 'agent'
      ? { hook_event_name: name, ...(sessionId === undefined ? {} : { session_id: sessionId }) }
      : {
          hook_event_name: name,
          ...(sessionId === undefined ? {} : { session_id: sessionId }),
          ...(cwd === undefined ? {} : { cwd }),
          ...(payload['prompt'] === undefined ? {} : { prompt: payload['prompt'] }),
          ...(payload['source'] === undefined ? {} : { source: payload['source'] }),
          ...(toolName === undefined
            ? {}
            : { tool_name: toolName, tool_input: payload['toolInput'] ?? payload['toolArgs'] }),
        };
  return claudeCodeAdapter.readHook({ ...input, body: JSON.stringify(body) });
}
