import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { readClaudeHeadless } from '../../../../../electron/main/harness/claude-code/headless-reader';
import type { RunEvent } from '../../../../../electron/main/harness/port';

/** Push every chunk into one reader and return the events, flushed or not. */
const readAll = (chunks: string[], flush = false): RunEvent[] => {
  const reader = readClaudeHeadless();
  const events = chunks.flatMap((chunk) => reader.push(chunk));

  return flush ? [...events, ...reader.flush()] : events;
};

const line = (event: Record<string, unknown>) => `${JSON.stringify(event)}\n`;

const assistant = (text: string) =>
  line({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text }] } });

const toolUse = (name: string, input: Record<string, unknown>) =>
  line({ type: 'assistant', message: { id: 'msg_2', content: [{ type: 'tool_use', name, input }] } });

const result = (over: Record<string, unknown> = {}) =>
  line({ type: 'result', subtype: 'success', ...over });

describe('readClaudeHeadless', () => {
  it('is the adapter’s headless reader, a fresh one per call', () => {
    const first = claudeCodeAdapter.headless.reader();

    first.push('{"type":"assist');
    expect(claudeCodeAdapter.headless.reader().flush()).toEqual([]);
  });

  it('reads assistant text as say, trimmed', () => {
    expect(readAll([assistant('  hello ')])).toEqual([{ kind: 'say', text: 'hello' }]);
  });

  it('drops an empty text block', () => {
    expect(readAll([assistant('   ')])).toEqual([]);
  });

  it('reads a tool call with its first string argument, uncut', () => {
    const long = 'x'.repeat(80);

    expect(readAll([toolUse('Bash', { timeout: 5, command: long })])).toEqual([
      { kind: 'tool', name: 'Bash', args: long },
    ]);
  });

  it('reads a tool call with no string argument as empty args', () => {
    expect(readAll([toolUse('TodoWrite', { todos: [] })])).toEqual([
      { kind: 'tool', name: 'TodoWrite', args: '' },
    ]);
  });

  it('marks the ledger ask', () => {
    expect(readAll([toolUse('mcp__hive__ledger_ask', { body: 'which repo?' })])).toEqual([
      { kind: 'tool', name: 'mcp__hive__ledger_ask', args: 'which repo?', ask: true },
    ]);
  });

  it('reassembles an object split across two chunks', () => {
    const whole = assistant('split me');

    expect(readAll([whole.slice(0, 20), whole.slice(20)])).toEqual([
      { kind: 'say', text: 'split me' },
    ]);
  });

  it('reads a malformed line as nothing rather than throwing', () => {
    expect(() => readAll(['not json at all\n', '[1,2]\n', 'null\n'])).not.toThrow();
    expect(readAll(['not json at all\n', '[1,2]\n', 'null\n'])).toEqual([]);
  });

  it('holds an unterminated final line until flush', () => {
    const reader = readClaudeHeadless();

    expect(reader.push(assistant('kept').trimEnd())).toEqual([]);
    expect(reader.flush()).toEqual([{ kind: 'say', text: 'kept' }]);
    expect(reader.flush()).toEqual([]);
  });

  it('reads result as the conversation, then the end with cost and turns', () => {
    expect(
      readAll([
        result({ num_turns: 3, total_cost_usd: 0.0241, session_id: 'f9589d3c' }),
      ]),
    ).toEqual([
      { kind: 'conversation', id: 'f9589d3c' },
      { kind: 'end', stop: 'done', detail: 'success', costUsd: 0.0241, turns: 3 },
    ]);
  });

  it('omits cost and turns that are not numbers, and spells a missing subtype unknown', () => {
    expect(readAll([line({ type: 'result', total_cost_usd: '1', num_turns: null })])).toEqual([
      { kind: 'end', stop: 'error', detail: 'unknown' },
    ]);
  });

  it.each([
    ['success', 'done'],
    ['error_max_turns', 'turns'],
    ['error_max_budget_usd', 'budget'],
    ['error_during_execution', 'error'],
  ] as const)('reads the %s subtype as stop %s', (subtype, stop) => {
    expect(readAll([result({ subtype })])).toEqual([{ kind: 'end', stop, detail: subtype }]);
  });

  it('skips system and rate-limit noise', () => {
    expect(
      readAll([
        line({ type: 'system', subtype: 'thinking_tokens' }),
        line({ type: 'rate_limit_event' }),
        line({ type: 'user', message: {} }),
      ]),
    ).toEqual([]);
  });

  /**
   * `result` and the line after it routinely share a chunk, which is how the CLI ends a turn.
   * The trailing noise must read as nothing, not as a second end.
   */
  it('reads a result followed by noise in one chunk as exactly one end', () => {
    const events = readAll([
      result({ session_id: 'uuid-1' }) + line({ type: 'system', subtype: 'thinking_tokens' }),
    ]);

    expect(events.filter((event) => event.kind === 'end')).toHaveLength(1);
    expect(events).toContainEqual({ kind: 'conversation', id: 'uuid-1' });
  });

  it('reads init as the conversation, then the mcp servers it named', () => {
    expect(
      readAll([
        line({
          type: 'system',
          subtype: 'init',
          session_id: 'sess-9',
          mcp_servers: [
            { name: 'hive', status: 'connected' },
            { name: 'slack', status: 'needs-auth' },
            { name: 7 },
          ],
        }),
      ]),
    ).toEqual([
      { kind: 'conversation', id: 'sess-9' },
      {
        kind: 'mcp',
        servers: [
          { name: 'hive', status: 'connected' },
          { name: 'slack', status: 'needs-auth' },
        ],
      },
    ]);
  });

  it('reads an init with no server list as no mcp event', () => {
    expect(readAll([line({ type: 'system', subtype: 'init' })])).toEqual([]);
  });
});
