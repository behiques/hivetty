import { formatRunCost, type RunLine } from '@shared/agent-contract';

import type { McpServerStatus, RunEnd, RunEvent } from '../harness/port';

/**
 * A headless run's events folded into run-log lines (HIVE-115, HIVE-338).
 *
 * Harness-neutral: the adapter's reader turns a CLI's output into `RunEvent`s, and this decides
 * what the user sees of them — the spelling and colour of each line, and where a turn ends.
 * The state only moves forward, so a batch whose later events say nothing about the end cannot
 * revert an end reported earlier in it.
 */

/** How much of a tool's arguments the log shows. */
const ARG_LIMIT = 60;

/** What one run's events have said so far. Each field only moves forward. */
export interface EventFold {
  end: RunEnd | null;
  conversation: string | null;
  mcpServers: McpServerStatus[] | null;
}

export const NO_EVENTS: EventFold = { end: null, conversation: null, mcpServers: null };

const cut = (args: string): string =>
  args.length > ARG_LIMIT ? `${args.slice(0, ARG_LIMIT)}…` : args;

export function foldRunEvents(
  state: EventFold,
  events: readonly RunEvent[],
): { state: EventFold; lines: RunLine[]; conversation?: string } {
  const lines: RunLine[] = [];
  let { end, conversation, mcpServers } = state;
  let named: string | undefined;

  for (const event of events) {
    switch (event.kind) {
      case 'conversation':
        conversation = event.id;
        named = event.id;
        break;
      case 'mcp':
        mcpServers = event.servers;
        break;
      case 'say':
        lines.push({ text: event.text, color: 'ink' });
        break;
      case 'tool':
        lines.push({
          text: event.args === '' ? event.name : `${event.name} ${cut(event.args)}`,
          // An ask is the one tool call that changes what the user must do.
          color: event.ask === true ? 'amber' : 'dim',
        });
        break;
      case 'end': {
        end = event;
        // The contract's formatter, not a second one: this line and the agent row show
        // one run's cost, and two spellings of it on one screen is a bug.
        const formatted = formatRunCost(event.costUsd);

        lines.push({
          text: `● turn ended — ${event.detail}${formatted === undefined ? '' : ` · ${formatted}`}`,
          color: 'cyan',
          // The renderer splits the buffer on it; see `RunLine.endsTurn`.
          endsTurn: true,
        });
        break;
      }
    }
  }

  return {
    state: { end, conversation, mcpServers },
    lines,
    ...(named === undefined ? {} : { conversation: named }),
  };
}
