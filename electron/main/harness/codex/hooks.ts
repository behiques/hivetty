import { claudeCodeAdapter } from '../claude-code';
import { planOpOf } from '../claude-code/plan-ops';
import type { HookInput, HookReading } from '../port';

/**
 * Codex's hooks, read (HIVE-352). Claude's reader, because codex 0.164 sends Claude-shaped
 * payloads, plus the one plan tool Claude does not have: `update_plan`.
 *
 * `update_plan` is `TodoWrite` by other names, the whole list on every call with no ids:
 * `{plan: [{step, status}], explanation?}` (`tests/fixtures/codex/hooks-update-plan-*`). So it is
 * read as one, ids `"1".."n"` by position. `explanation` has nowhere to go on a plan task.
 *
 * Session lane, main thread, whole bodies only, as Claude's plan ops are: a subagent's call carries
 * `agent_id` under its parent's `session_id`. Interactive Codex is HIVE-279's, and an agent run has
 * no plan for any CLI yet, so nothing reaches this today but a test.
 */
export function readCodexHook(input: HookInput): HookReading {
  const reading = claudeCodeAdapter.readHook(input);
  if (input.lane !== 'session' || input.truncated || reading.malformed === true) return reading;

  const fields = JSON.parse(input.body) as Record<string, unknown> | null;
  if (
    fields?.['hook_event_name'] !== 'PostToolUse' ||
    fields['tool_name'] !== 'update_plan' ||
    fields['agent_id'] !== undefined
  ) {
    return reading;
  }

  const plan = (fields['tool_input'] as { plan?: unknown } | null | undefined)?.plan;
  if (!Array.isArray(plan)) return reading;

  const todos = plan.map((step: unknown) => {
    const { step: content, status } = (step ?? {}) as { step?: unknown; status?: unknown };
    return { content, status };
  });
  const op = planOpOf('TodoWrite', { todos }, undefined);
  if (op === undefined) return reading;

  const cwd = fields['cwd'];
  return {
    ...reading,
    effects: [
      ...reading.effects,
      { kind: 'plan', update: { entityId: input.entityId, op, ...(typeof cwd === 'string' && cwd !== '' ? { cwd } : {}) } },
    ],
  };
}
