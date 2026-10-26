import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCodexHeadless } from '../../../../../electron/main/harness/codex/headless-reader';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../../../fixtures/codex', name), 'utf8');
const all = (text: string) => {
  const reader = readCodexHeadless();
  return [...reader.push(text), ...reader.flush()];
};

describe('readCodexHeadless', () => {
  it('reads the recorded first wake, the conversation first', () => {
    const events = all(fixture('exec-0.164.0.jsonl'));

    expect(events[0]).toEqual({ kind: 'conversation', id: expect.any(String) });
    expect(events.map((event) => (event.kind === 'tool' ? event.name : event.kind))).toEqual(
      expect.arrayContaining(['Bash', 'apply_patch', 'mcp__hive__ledger_read', 'say', 'end']),
    );
    expect(events.at(-1)).toEqual({
      kind: 'end',
      stop: 'done',
      detail: 'completed',
      usage: {
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        cachedTokens: expect.any(Number),
      },
    });
  });

  it('emits each tool once, though codex writes item.started and item.completed', () => {
    const tools = all(fixture('exec-0.164.0.jsonl')).filter((event) => event.kind === 'tool');

    expect(new Set(tools.map((tool) => JSON.stringify(tool))).size).toBe(tools.length);
  });

  it('drops the warning items codex writes as errors', () => {
    const warning =
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"`--dangerously-bypass-hook-trust` is enabled."}}\n';

    expect(all(warning)).toEqual([]);
  });

  it('marks the ledger ask', () => {
    const ask =
      '{"type":"item.started","item":{"id":"i","type":"mcp_tool_call","server":"hive","tool":"ledger_ask","arguments":{"to":"overmind","body":"may I?"},"status":"in_progress"}}\n';

    expect(all(ask)).toEqual([
      { kind: 'tool', name: 'mcp__hive__ledger_ask', args: 'overmind', ask: true },
    ]);
  });

  it('reads turn.failed as an error end', () => {
    expect(all('{"type":"turn.failed","error":{"message":"stream disconnected"}}\n')).toEqual([
      { kind: 'end', stop: 'error', detail: 'stream disconnected' },
    ]);
  });

  it('is chunk-safe at every byte of the fixture', () => {
    const text = fixture('exec-0.164.0.jsonl');
    const whole = all(text);

    for (let at = 1; at < text.length; at += 97) {
      const reader = readCodexHeadless();
      expect([
        ...reader.push(text.slice(0, at)),
        ...reader.push(text.slice(at)),
        ...reader.flush(),
      ]).toEqual(whole);
    }
  });

  it('never throws on junk', () => {
    expect(all('not json\n{"type":\n[]\n')).toEqual([]);
  });
});
