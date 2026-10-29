import type { SessionMetrics } from '@shared/metrics-contract';

/*
  What a Codex rollout says about its own usage (HIVE-334). `turn_context` carries the model and
  effort a turn ran with; `event_msg` `token_count` carries context use, the plan's limit windows
  and its credits. The rollout is the only place a TUI session writes them (`codex` has no status line).
*/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Codex's own baseline: `BASELINE_TOKENS` in codex-rs/protocol/src/protocol.rs (rust-v0.165.0). */
const BASELINE_TOKENS = 12_000;

/**
 * Context used, 0–100, by the formula Codex's TUI shows as "% context left", so the two agree (D3):
 * `TokenUsage::percent_of_context_window_remaining` in codex-rs/protocol/src/protocol.rs (rust-v0.165.0),
 * fed `last_token_usage`'s `total_tokens`.
 */
export function codexContextPct(tokens: number, window: number): number {
  if (window <= BASELINE_TOKENS) return 100;
  const effective = window - BASELINE_TOKENS;
  const used = Math.max(tokens - BASELINE_TOKENS, 0);
  return 100 - Math.round((Math.max(effective - used, 0) / effective) * 100);
}

/** Window length in minutes → the gauge it fills. Any other length is shown nowhere (D6). */
const WINDOWS: Readonly<Record<number, 'fiveHour' | 'sevenDay'>> = { 300: 'fiveHour', 10080: 'sevenDay' };

function readUsage(out: SessionMetrics, info: unknown): void {
  if (!isObject(info) || !isObject(info.last_token_usage)) return;
  const window = num(info.model_context_window);
  const tokens = num(info.last_token_usage.total_tokens);
  if (window === undefined || tokens === undefined) return;
  out.contextWindow = window;
  out.contextPct = codexContextPct(tokens, window);
}

function readLimits(out: SessionMetrics, limits: unknown): void {
  if (!isObject(limits)) return;
  // By length, never by slot: Pro has no five-hour window, so its week sits in `primary`.
  for (const slot of [limits.primary, limits.secondary]) {
    if (!isObject(slot)) continue;
    const minutes = num(slot.window_minutes);
    const gauge = minutes === undefined ? undefined : WINDOWS[minutes];
    const pct = num(slot.used_percent);
    if (gauge === undefined || pct === undefined) continue;
    out[`${gauge}Pct`] = pct;
    const resets = num(slot.resets_at);
    if (resets !== undefined) out[`${gauge}ResetsAt`] = resets;
  }
  const credits = limits.credits;
  if (!isObject(credits)) return;
  const unlimited = credits.unlimited === true;
  if (credits.has_credits !== true && !unlimited) return;
  out.creditsUnlimited = unlimited;
  if (credits.has_credits === true && typeof credits.balance === 'string') out.creditsBalance = credits.balance;
}

/** Rollout lines folded into a metrics patch: the last value each field took, `{}` for none (HIVE-334). */
export function foldCodexMeters(lines: readonly string[]): SessionMetrics {
  const out: SessionMetrics = {};
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(record) || !isObject(record.payload)) continue;
    const { payload } = record;
    if (record.type === 'turn_context') {
      if (typeof payload.model === 'string') out.model = payload.model;
      if (typeof payload.effort === 'string' && payload.effort !== '') out.effort = payload.effort;
    } else if (record.type === 'event_msg' && payload.type === 'token_count') {
      readUsage(out, payload.info);
      readLimits(out, payload.rate_limits);
    }
  }
  return out;
}
