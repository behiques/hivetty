import { describe, expect, it } from 'vitest';

import { NO_EVENTS, foldRunEvents } from '../../../../electron/main/agents/run-log';
import type { RunEvent } from '../../../../electron/main/harness/port';

const fold = (...events: RunEvent[]) => foldRunEvents(NO_EVENTS, events);

describe('foldRunEvents', () => {
  it('renders the agent speaking as ink', () => {
    expect(fold({ kind: 'say', text: 'hello' }).lines).toEqual([{ text: 'hello', color: 'ink' }]);
  });

  it('renders a tool call as a dim name and short argument', () => {
    expect(fold({ kind: 'tool', name: 'Bash', args: 'echo hi' }).lines).toEqual([
      { text: 'Bash echo hi', color: 'dim' },
    ]);
  });

  it('renders a tool call with no argument as its name alone', () => {
    expect(fold({ kind: 'tool', name: 'TodoWrite', args: '' }).lines).toEqual([
      { text: 'TodoWrite', color: 'dim' },
    ]);
  });

  it('cuts a long argument at sixty characters', () => {
    expect(fold({ kind: 'tool', name: 'Bash', args: 'x'.repeat(61) }).lines).toEqual([
      { text: `Bash ${'x'.repeat(60)}…`, color: 'dim' },
    ]);
  });

  it('renders a ledger ask in amber', () => {
    expect(
      fold({ kind: 'tool', name: 'mcp__hive__ledger_ask', args: 'which repo?', ask: true }).lines,
    ).toEqual([{ text: 'mcp__hive__ledger_ask which repo?', color: 'amber' }]);
  });

  it('keeps the end and renders it in cyan, closing the turn', () => {
    const end = { kind: 'end', stop: 'done', detail: 'success', costUsd: 0.0241, turns: 3 } as const;
    const step = fold(end);

    expect(step.state.end).toEqual(end);
    /*
      `endsTurn` is asserted here, not merely tolerated. The renderer splits the
      buffer on it to draw newest-turn-first, so this is the one place the
      boundary is written — and a fold emitted without it collapses several
      turns into one block with no test anywhere else to notice.
    */
    expect(step.lines).toEqual([
      { text: '● turn ended — success · $0.02', color: 'cyan', endsTurn: true },
    ]);
  });

  it('spells the cost with the contract formatter, not a second one', () => {
    expect(fold({ kind: 'end', stop: 'done', detail: 'success', costUsd: 0.0009 }).lines).toEqual([
      { text: '● turn ended — success · $0.0009', color: 'cyan', endsTurn: true },
    ]);
  });

  it('spells an end with no cost without a chip', () => {
    expect(fold({ kind: 'end', stop: 'error', detail: 'unknown' }).lines).toEqual([
      { text: '● turn ended — unknown', color: 'cyan', endsTurn: true },
    ]);
  });

  it('keeps an end reported earlier when later events say nothing of it', () => {
    const end = { kind: 'end', stop: 'done', detail: 'success' } as const;
    const after = foldRunEvents(fold(end).state, [{ kind: 'say', text: 'more' }]);

    expect(after.state.end).toEqual(end);
  });

  it('keeps the last conversation and reports it on the step that carried it', () => {
    const first = fold({ kind: 'conversation', id: 'a' }, { kind: 'conversation', id: 'b' });

    expect(first.state.conversation).toBe('b');
    expect(first.conversation).toBe('b');

    const next = foldRunEvents(first.state, [{ kind: 'say', text: 'x' }]);

    expect(next.state.conversation).toBe('b');
    expect(next.conversation).toBeUndefined();
    expect(first.lines).toEqual([]);
  });

  it('records the mcp servers, and leaves them null until told', () => {
    expect(fold().state.mcpServers).toBeNull();
    expect(
      fold({ kind: 'mcp', servers: [{ name: 'slack', status: 'needs-auth' }] }).state.mcpServers,
    ).toEqual([{ name: 'slack', status: 'needs-auth' }]);
  });
});
