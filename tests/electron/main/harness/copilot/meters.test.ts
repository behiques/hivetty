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
