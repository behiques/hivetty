import type { RunEvent, RunEventReader } from '../port';

/**
 * `codex exec --json` read into run events (HIVE-342). Recorded against 0.164.0
 * (`tests/fixtures/codex/`).
 *
 * `thread.started` is the first line codex writes, before any tool can run, so the tracker knows
 * the conversation before a Stop hook can name it. `error` items are warnings (an unknown `-c`
 * key, the hook-trust bypass), not failures; `turn.failed` is the failure.
 */

/** The tool whose call changes what the user must do. */
const ASK_TOOL = 'mcp__hive__ledger_ask';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const firstString = (input: unknown): string => {
  const record = asRecord(input);
  if (record === null) return '';
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value !== '') return value;
  }
  return '';
};

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

/** A tool item in `PreToolUse`'s vocabulary, so the run log and the fence name calls alike. */
function toolOf(item: Record<string, unknown>): RunEvent | null {
  if (item['type'] === 'command_execution' && typeof item['command'] === 'string') {
    return { kind: 'tool', name: 'Bash', args: item['command'] };
  }
  if (item['type'] === 'file_change') {
    const first = asRecord(Array.isArray(item['changes']) ? item['changes'][0] : undefined);
    const path = first?.['path'];
    return { kind: 'tool', name: 'apply_patch', args: typeof path === 'string' ? path : '' };
  }
  if (
    item['type'] === 'mcp_tool_call' &&
    typeof item['server'] === 'string' &&
    typeof item['tool'] === 'string'
  ) {
    const name = `mcp__${item['server']}__${item['tool']}`;
    return {
      kind: 'tool',
      name,
      args: firstString(item['arguments']),
      ...(name === ASK_TOOL ? { ask: true as const } : {}),
    };
  }
  return null;
}

function endOf(usage: Record<string, unknown> | null): RunEvent {
  if (usage === null) return { kind: 'end', stop: 'done', detail: 'completed' };
  const inputTokens = num(usage['input_tokens']);
  const outputTokens = num(usage['output_tokens']);
  const cachedTokens = num(usage['cached_input_tokens']);
  return {
    kind: 'end',
    stop: 'done',
    detail: 'completed',
    usage: {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(cachedTokens === undefined ? {} : { cachedTokens }),
    },
  };
}

export function readCodexHeadless(): RunEventReader {
  let tail = '';
  const seen = new Set<string>();

  const readItem = (type: unknown, item: Record<string, unknown>): RunEvent[] => {
    if (item['type'] === 'agent_message') {
      if (type !== 'item.completed' || typeof item['text'] !== 'string') return [];
      const said = item['text'].trim();
      return said === '' ? [] : [{ kind: 'say', text: said }];
    }

    const tool = toolOf(item);
    const id = typeof item['id'] === 'string' ? item['id'] : '';
    // Once per item: a call shows on `item.started`, and `item.completed` repeats it.
    if (tool === null || seen.has(id)) return [];
    seen.add(id);
    return [tool];
  };

  const readLine = (line: string): RunEvent[] => {
    const text = line.trim();
    if (text === '') return [];

    let event: Record<string, unknown> | null;
    try {
      event = asRecord(JSON.parse(text));
    } catch {
      return [];
    }
    if (event === null) return [];

    const type = event['type'];

    if (type === 'thread.started' && typeof event['thread_id'] === 'string') {
      return [{ kind: 'conversation', id: event['thread_id'] }];
    }

    if (type === 'item.started' || type === 'item.completed') {
      const item = asRecord(event['item']);
      return item === null ? [] : readItem(type, item);
    }

    if (type === 'turn.completed') return [endOf(asRecord(event['usage']))];

    if (type === 'turn.failed') {
      const message = asRecord(event['error'])?.['message'];
      return [
        { kind: 'end', stop: 'error', detail: typeof message === 'string' ? message : 'failed' },
      ];
    }

    return [];
  };

  return {
    push(chunk) {
      const parts = `${tail}${chunk}`.split('\n');
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
