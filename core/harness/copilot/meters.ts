import type { SessionMetrics } from '@shared/metrics-contract';

/*
  What a Copilot session's OTel file export says about its usage (HIVE-335), measured on 1.0.105
  (tests/fixtures/copilot/otel-1.0.105). Every model call is a `chat` span carrying the model, its
  token counts and `github.copilot.nano_aiu`; the sums match Copilot's own footer. Each turn's
  `invoke_agent` span repeats the turn's totals, so only `chat` spans count.

  `model` is the last chat span's. After a subagent call that is the main agent's own closing call
  in practice; a subagent ending a turn would show its model until the next call.

  Context (the follow-up) is the turn's last `github.copilot.session.usage_info` event on the
  top-level `invoke_agent` span. A subagent's own reading lands on that same span while the subagent
  runs (subagent.jsonl: the explore agent's 4747 of 200000 between the main agent's two), so an event
  inside a nested `invoke_agent`'s window is not the session's. A turn's trace is exported whole, in
  one batch, so the nested span is always in the same read.
*/

type Span = Record<string, unknown> & { attributes: Record<string, unknown> };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
/** An OTel `[seconds, nanoseconds]` time in milliseconds; `undefined` for any other shape. */
const ms = (value: unknown): number | undefined => {
  if (!Array.isArray(value)) return undefined;
  const [sec, nanos] = value.map(num);
  return sec === undefined || nanos === undefined ? undefined : sec * 1e3 + nanos / 1e6;
};

/** Span attribute → the total it adds to. */
const TOKENS = {
  'gen_ai.usage.input_tokens': 'tokensIn',
  'gen_ai.usage.output_tokens': 'tokensOut',
  'gen_ai.usage.cache_read.input_tokens': 'tokensCached',
  'gen_ai.usage.cache_write.input_tokens': 'tokensWritten',
} as const;

type TokenField = (typeof TOKENS)[keyof typeof TOKENS];

const parse = (line: string): Span | null => {
  try {
    const record: unknown = JSON.parse(line);
    return isObject(record) && record.type === 'span' && isObject(record.attributes) ? (record as Span) : null;
  } catch {
    return null;
  }
};

const isAgent = (span: Span): boolean => span.attributes['gen_ai.operation.name'] === 'invoke_agent';

/**
 * Context used, from the last `usage_info` event outside every subagent window (HIVE-335 follow-up).
 * Rounded down, as Copilot's own `/context` shows it: 29290 of 272000 read "(10%)" there, measured on
 * 1.0.105 (context.jsonl). A latest value, never summed.
 */
function readContext(out: SessionMetrics, events: unknown, subagents: readonly [number, number][]): void {
  if (!Array.isArray(events)) return;
  for (const event of events) {
    if (!isObject(event) || event.name !== 'github.copilot.session.usage_info' || !isObject(event.attributes)) continue;
    const at = ms(event.time);
    if (at !== undefined && subagents.some(([start, end]) => at >= start && at <= end)) continue;
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
  const spans = lines.map(parse).filter((span): span is Span => span !== null);

  // Each subagent's run, by trace: a nested invoke_agent (it sits under the tool call that ran it).
  const subagents = new Map<unknown, [number, number][]>();
  for (const span of spans) {
    if (!isAgent(span) || span.parentSpanId === undefined) continue;
    const start = ms(span.startTime);
    const end = ms(span.endTime);
    if (start === undefined || end === undefined) continue;
    subagents.set(span.traceId, [...(subagents.get(span.traceId) ?? []), [start, end]]);
  }

  for (const span of spans) {
    const attrs = span.attributes;
    if (isAgent(span) && span.parentSpanId === undefined) {
      readContext(out, span.events, subagents.get(span.traceId) ?? []);
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
