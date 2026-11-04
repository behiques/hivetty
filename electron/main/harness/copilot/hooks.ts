import { claudeCodeAdapter } from '../claude-code';
import type { HookInput, HookReading } from '../port';

/** Copilot's session events in Claude's spelling (HIVE-280, FINDINGS P0 and P1). */
const CLAUDE_EVENT: Record<string, string> = {
  sessionStart: 'SessionStart',
  userPromptSubmitted: 'UserPromptSubmit',
  // Read only once its prompt is drawn, off the `permission_prompt` that follows it (FINDINGS P12).
  permissionRequest: 'PermissionRequest',
  postToolUse: 'PostToolUse',
  agentStop: 'Stop',
  // `ask_user`'s dialog, and the prompt drawn for a `permissionRequest` (FINDINGS P2, P12). Read below.
  notification: 'PermissionRequest',
};

/**
 * File writes, by one name (FINDINGS P1). `permissionRequest` names the permission kind `edit` for
 * every file tool while `postToolUse` names the tool itself, and the tracker clears a block by name.
 */
const WRITE_TOOLS = new Set(['edit', 'create', 'apply_patch']);

/**
 * Copilot's own question tool, as Claude's, so its dialog reads as a question and its answer clears it.
 * The dialog's `notification` names no tool; `ask_user`'s `postToolUse` follows the answer (P2).
 */
const QUESTION_TOOL = 'AskUserQuestion';

const claudeToolName = (tool: string | undefined): string | undefined =>
  tool === undefined ? undefined : WRITE_TOOLS.has(tool) ? 'edit' : tool === 'ask_user' ? QUESTION_TOOL : tool;

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * Each session's last `permissionRequest`, until the `permission_prompt` that says Copilot drew it.
 * Copilot fires the request for every call, the user's own approvals and `--allow-tool` included, and
 * draws the prompt only for a call nobody approved (FINDINGS P11, P12). The notification names no tool,
 * so the card is read off the request it follows. It always follows: Copilot waits on the request's hook
 * before deciding to draw. A `postToolUse` or `agentStop` with no prompt between forgets the request.
 */
// ponytail: a session killed between a request and its result keeps one entry; key by lifetime if that ever adds up.
const unprompted = new Map<string, Record<string, unknown>>();

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
  let { event, payload } = (envelope ?? {}) as { event?: unknown; payload?: Record<string, unknown> };
  if (typeof event !== 'string' || typeof payload !== 'object' || payload === null) return { effects: [] };
  if (input.lane === 'agent' && event !== 'agentStop') return { effects: [] };
  const name = CLAUDE_EVENT[event];
  if (name === undefined) return { effects: [] };
  if (event === 'agentStop' && payload['agentId'] !== undefined) return { effects: [] };

  if (event === 'permissionRequest') {
    unprompted.set(input.entityId, payload);
    return { effects: [] };
  }
  if (event === 'postToolUse' || event === 'agentStop') unprompted.delete(input.entityId);
  if (event === 'notification' && payload['notification_type'] === 'permission_prompt') {
    const request = unprompted.get(input.entityId);
    unprompted.delete(input.entityId);
    if (request === undefined) return { effects: [] };
    event = 'permissionRequest';
    payload = request;
  } else if (event === 'notification' && payload['notification_type'] !== 'elicitation_dialog') {
    return { effects: [] };
  }

  const sessionId = text(payload['sessionId']);
  const cwd = text(payload['cwd']);
  const toolName = event === 'notification' ? QUESTION_TOOL : claudeToolName(text(payload['toolName']));
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
