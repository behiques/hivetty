import type { SessionMetrics } from '@shared/metrics-contract';

/*
  What a Copilot session's OTel file export says about its usage (HIVE-335), measured on 1.0.105
  (tests/fixtures/copilot/otel-1.0.105). Every model call is a `chat` span carrying the model, its
  token counts and `github.copilot.nano_aiu`; the sums match Copilot's own footer. Each turn's
  `invoke_agent` span repeats the turn's totals, so only `chat` spans count.

  `model` is the last chat span's. After a subagent call that is the main agent's own closing call
  in practice; a subagent ending a turn would show its model until the next call.
*/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Span attribute → the total it adds to. */
const TOKENS = {
  'gen_ai.usage.input_tokens': 'tokensIn',
  'gen_ai.usage.output_tokens': 'tokensOut',
  'gen_ai.usage.cache_read.input_tokens': 'tokensCached',
  'gen_ai.usage.cache_write.input_tokens': 'tokensWritten',
} as const;

type TokenField = (typeof TOKENS)[keyof typeof TOKENS];

/**
 * Context used, from the turn's last `github.copilot.session.usage_info` event (HIVE-335 follow-up).
 * Rounded down, as Copilot's own `/context` shows it: 29290 of 272000 read "(10%)" there, measured on
 * 1.0.105 (tests/fixtures/copilot/otel-1.0.105/context.jsonl). A latest value, never summed.
 */
function readContext(out: SessionMetrics, events: unknown): void {
  if (!Array.isArray(events)) return;
  for (const event of events) {
    if (!isObject(event) || event.name !== 'github.copilot.session.usage_info' || !isObject(event.attributes)) continue;
    const limit = num(event.attributes['github.copilot.token_limit']);
    const current = num(event.attributes['github.copilot.current_tokens']);
    if (limit === undefined || current === undefined || limit <= 0) continue;
    out.contextWindow = limit;
    out.contextPct = Math.min(100, Math.max(0, Math.floor((current / limit) * 100)));
  }
}

/** Export lines folded onto `prior`'s totals; a field no span reported stays out (HIVE-335). */
export function foldCopilotMeters(lines: readonly string[], prior: SessionMetrics = {}): SessionMetrics {
  const out: SessionMetrics = {};
  if (prior.model !== undefined) out.model = prior.model;
  if (prior.aiCredits !== undefined) out.aiCredits = prior.aiCredits;
  for (const field of Object.values(TOKENS)) {
    if (prior[field] !== undefined) out[field] = prior[field];
  }
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(record) || record.type !== 'span' || !isObject(record.attributes)) continue;
    const attrs = record.attributes;
    // A subagent's own invoke_agent sits under the tool call that ran it; only the session's counts.
    if (attrs['gen_ai.operation.name'] === 'invoke_agent' && record.parentSpanId === undefined) {
      readContext(out, record.events);
    }
    if (attrs['gen_ai.operation.name'] !== 'chat') continue;
    if (typeof attrs['gen_ai.request.model'] === 'string') out.model = attrs['gen_ai.request.model'];
    for (const [attr, field] of Object.entries(TOKENS) as [keyof typeof TOKENS, TokenField][]) {
      const count = num(attrs[attr]);
      if (count !== undefined) out[field] = (out[field] ?? 0) + count;
    }
    const nano = num(attrs['github.copilot.nano_aiu']);
    if (nano !== undefined) out.aiCredits = (out.aiCredits ?? 0) + nano / 1e9;
  }
  return out;
}
