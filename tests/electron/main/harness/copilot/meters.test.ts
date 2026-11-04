import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { foldCopilotMeters } from '../../../../../electron/main/harness/copilot/meters';

const lines = readFileSync(join(__dirname, '../../../../fixtures/copilot/otel-1.0.105/turn.jsonl'), 'utf8').split('\n');

describe('foldCopilotMeters (HIVE-335)', () => {
  it('sums the chat spans of a real 1.0.105 export, as Copilot’s footer does', () => {
    const out = foldCopilotMeters(lines);
    expect(out).toMatchObject({
      model: 'claude-sonnet-5.5',
      tokensIn: 61741,
      tokensOut: 109,
      tokensCached: 49589,
      tokensWritten: 12146,
    });
    // Footer: "AI Credits 3.64". nano-AIU ÷ 10⁹, not the premium-request `cost` (1).
    expect(out.aiCredits).toBeCloseTo(3.64259, 9);
  });

  it('never counts the invoke_agent turn totals a second time', () => {
    const agentOnly = lines.filter((line) => line.includes('"invoke_agent"'));
    expect(agentOnly.length).toBeGreaterThan(0);
    expect(foldCopilotMeters(agentOnly)).toEqual({});
  });

  it('adds to prior totals, so a session sums across reads', () => {
    const out = foldCopilotMeters(lines, {
      model: 'old',
      tokensIn: 1,
      tokensOut: 2,
      tokensCached: 3,
      tokensWritten: 4,
      aiCredits: 1,
    });
    expect(out).toMatchObject({
      model: 'claude-sonnet-5.5',
      tokensIn: 61742,
      tokensOut: 111,
      tokensCached: 49592,
      tokensWritten: 12150,
    });
    expect(out.aiCredits).toBeCloseTo(4.64259, 9);
  });

  it('leaves out what no span reported, and reads past junk', () => {
    const span = JSON.stringify({
      type: 'span',
      name: 'chat m',
      attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'm', 'gen_ai.usage.input_tokens': 5 },
    });
    expect(foldCopilotMeters(['', 'not json', '[]', span])).toEqual({ model: 'm', tokensIn: 5 });
    expect(foldCopilotMeters([])).toEqual({});
  });
});

const context = readFileSync(join(__dirname, '../../../../fixtures/copilot/otel-1.0.105/context.jsonl'), 'utf8').split('\n');

/** A turn's `invoke_agent` span carrying `usage_info` events, as 1.0.105 writes it; top-level unless given a parent. */
const agentSpan = (usage: [current: number, limit: number][], parentSpanId?: string): string =>
  JSON.stringify({
    type: 'span',
    name: 'invoke_agent',
    ...(parentSpanId === undefined ? {} : { parentSpanId }),
    attributes: { 'gen_ai.operation.name': 'invoke_agent' },
    events: usage.map(([current, limit]) => ({
      name: 'github.copilot.session.usage_info',
      attributes: { 'github.copilot.token_limit': limit, 'github.copilot.current_tokens': current },
    })),
  });

describe('foldCopilotMeters context (HIVE-335 follow-up)', () => {
  it('reads the turn’s last usage_info, rounded down as /context shows it', () => {
    // Copilot's `/context` on this very turn: "28k/272k tokens (10%)". 29290 / 272000 = 10.77%.
    expect(foldCopilotMeters(context)).toMatchObject({ contextPct: 10, contextWindow: 272000 });
  });

  it('the latest turn wins, and a smaller one after /compact replaces it', () => {
    expect(foldCopilotMeters([agentSpan([[100_000, 200_000]]), agentSpan([[30_000, 200_000]])])).toMatchObject({
      contextPct: 15,
      contextWindow: 200_000,
    });
  });

  it('ignores a subagent’s own context: its invoke_agent is nested under a tool call', () => {
    expect(
      foldCopilotMeters([agentSpan([[20_000, 200_000]]), agentSpan([[190_000, 200_000]], 'abc123')]),
    ).toMatchObject({ contextPct: 10 });
    expect(foldCopilotMeters([agentSpan([[190_000, 200_000]], 'abc123')])).toEqual({});
  });

  it('leaves context out when a span reports no usable window, and clamps an overfull one', () => {
    expect(foldCopilotMeters([agentSpan([])])).toEqual({});
    expect(foldCopilotMeters([agentSpan([[5, 0]])])).toEqual({});
    expect(foldCopilotMeters([agentSpan([[300_000, 200_000]])])).toMatchObject({ contextPct: 100 });
  });

  it('is a latest value, not a total: prior context neither adds up nor repeats', () => {
    expect(foldCopilotMeters([agentSpan([[50_000, 200_000]])], { contextPct: 90, contextWindow: 200_000 })).toMatchObject({
      contextPct: 25,
    });
    expect(foldCopilotMeters([], { contextPct: 90, contextWindow: 200_000 })).toEqual({});
  });
});
