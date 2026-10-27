import { claudeCodeAdapter } from '../claude-code';
import type { HookInput, HookReading } from '../port';

/**
 * A Copilot agent-lane hook (HIVE-343). Copilot's bodies name no event, so the hook command wraps
 * each as `{"event":…,"payload":…}` (`hook-commands.ts`). Only `agentStop` acts. A subagent fires
 * its own (`agentId` set) mid-turn (probed at 1.0.104), and it must not arm the parent's watchdog.
 * The reading itself is Claude's, so the receiver's agent effects stay one shape.
 */
export function readCopilotHook(input: HookInput): HookReading {
  if (input.lane !== 'agent') return { effects: [] };
  if (input.truncated) return { malformed: true, effects: [] };
  let envelope: unknown;
  try {
    envelope = JSON.parse(input.body);
  } catch {
    return { malformed: true, effects: [] };
  }
  const { event, payload } = (envelope ?? {}) as { event?: unknown; payload?: Record<string, unknown> };
  if (event !== 'agentStop' || typeof payload !== 'object' || payload === null) return { effects: [] };
  if (payload['agentId'] !== undefined) return { effects: [] };
  const sessionId = typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined;
  return claudeCodeAdapter.readHook({
    ...input,
    body: JSON.stringify({ hook_event_name: 'Stop', ...(sessionId === undefined ? {} : { session_id: sessionId }) }),
  });
}
