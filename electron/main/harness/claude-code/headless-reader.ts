import type { McpServerStatus, RunEvent, RunEventReader, RunStop } from '../port';

/**
 * Claude Code's `--output-format stream-json` read into run events (HIVE-115, HIVE-338).
 *
 * ## Why the reader carries a tail
 *
 * A pipe splits wherever it likes. `{"type":"assistant"` and the rest of that object routinely
 * arrive as two chunks, and a parser that treated each chunk as whole lines would drop the event.
 * `result` is the LAST thing `claude` writes, so it is the line most likely to be sitting in the
 * tail, unterminated, when the process dies: `flush()` is what keeps its cost, turns and uuid.
 *
 * ## Why nothing here throws
 *
 * This runs inside a stdout handler. An unparseable line is silently nothing, and lines that are
 * not events share this pipe: warnings, and the `system` and `rate_limit_event` noise the CLI
 * writes between turns — including straight after `result`, in the same chunk.
 *
 * ## The stops
 *
 * `--max-turns` ends a run with `subtype: 'error_max_turns'` and `--max-budget-usd` with a subtype
 * naming the budget; both exit non-zero (measured against 2.1.251), so the stop is what tells
 * the core the run was capped rather than failed.
 */

/** The tool whose call changes what the user must do. */
const ASK_TOOL = 'mcp__hive__ledger_ask';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The first string value is what a reader recognises the call by: a Bash `command`, a Read `file_path`, a ledger `body`. */
const firstString = (input: unknown): string => {
  const record = asRecord(input);

  if (record === null) return '';

  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value !== '') return value;
  }

  return '';
};

const stopOf = (subtype: string): RunStop => {
  if (subtype === 'success') return 'done';
  if (subtype === 'error_max_turns') return 'turns';
  if (subtype.includes('budget')) return 'budget';

  return 'error';
};

const conversationOf = (event: Record<string, unknown>): RunEvent[] =>
  typeof event['session_id'] === 'string' ? [{ kind: 'conversation', id: event['session_id'] }] : [];

function readLine(line: string): RunEvent[] {
  const text = line.trim();

  if (text === '') return [];

  let event: Record<string, unknown> | null;

  try {
    event = asRecord(JSON.parse(text));
  } catch {
    return [];
  }

  if (event === null) return [];

  if (event['type'] === 'system' && event['subtype'] === 'init') {
    const servers = event['mcp_servers'];

    return [
      ...conversationOf(event),
      ...(Array.isArray(servers)
        ? [
            {
              kind: 'mcp' as const,
              servers: servers.filter(
                (server): server is McpServerStatus =>
                  typeof asRecord(server)?.['name'] === 'string' &&
                  typeof asRecord(server)?.['status'] === 'string',
              ),
            },
          ]
        : []),
    ];
  }

  if (event['type'] === 'assistant') {
    const content = asRecord(event['message'])?.['content'];

    if (!Array.isArray(content)) return [];

    return content.flatMap((raw): RunEvent[] => {
      const block = asRecord(raw);

      if (block?.['type'] === 'text' && typeof block['text'] === 'string') {
        const said = block['text'].trim();

        return said === '' ? [] : [{ kind: 'say', text: said }];
      }

      if (block?.['type'] === 'tool_use' && typeof block['name'] === 'string') {
        const name = block['name'];

        return [
          { kind: 'tool', name, args: firstString(block['input']), ...(name === ASK_TOOL ? { ask: true as const } : {}) },
        ];
      }

      return [];
    });
  }

  if (event['type'] === 'result') {
    const detail = typeof event['subtype'] === 'string' ? event['subtype'] : 'unknown';
    const costUsd = event['total_cost_usd'];
    const turns = event['num_turns'];

    return [
      ...conversationOf(event),
      {
        kind: 'end',
        stop: stopOf(detail),
        detail,
        ...(typeof costUsd === 'number' ? { costUsd } : {}),
        ...(typeof turns === 'number' ? { turns } : {}),
      },
    ];
  }

  return [];
}

export function readClaudeHeadless(): RunEventReader {
  let tail = '';

  return {
    push(chunk) {
      const parts = `${tail}${chunk}`.split('\n');

      // Whatever followed the final `\n`: empty when the chunk ended cleanly.
      tail = parts.pop() ?? '';

      return parts.flatMap(readLine);
    },
    flush() {
      const last = tail;

      tail = '';

      return readLine(last);
    },
  };
}
