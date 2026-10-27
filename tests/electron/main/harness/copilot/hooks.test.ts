import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { readCopilotHook } from '../../../../../electron/main/harness/copilot/hooks';
import type { HookInput } from '../../../../../electron/main/harness/port';

const HOOKS = join(__dirname, '../../../../fixtures/copilot/hooks-1.0.104');
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(HOOKS, name), 'utf8'));
/** The body the hook command POSTs: `{"event":…,"payload":…}` (`hook-commands.ts`). */
const wrapped = (payload: unknown, event = 'agentStop'): string => JSON.stringify({ event, payload });
const agent = (body: string, truncated = false): HookInput => ({ lane: 'agent', entityId: 'cop-agent', body, truncated });
const claudeStop = (sessionId: string) =>
  claudeCodeAdapter.readHook(
    agent(JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId })),
  );

describe('readCopilotHook', () => {
  it("reads agentStop as Claude's Stop on its own session", () => {
    const reading = readCopilotHook(agent(wrapped(fixture('agent-stop.json'))));

    expect(reading).toEqual(claudeStop('11111111-2222-4333-8444-555555555551'));
    expect(reading.effects).toHaveLength(1);
  });

  it("never reads a subagent's stop: it must not arm the parent's watchdog", () => {
    expect(readCopilotHook(agent(wrapped(fixture('agent-stop-subagent.json'))))).toEqual({ effects: [] });
  });

  it('reads the parent stop that follows a subagent for its own session', () => {
    expect(readCopilotHook(agent(wrapped(fixture('agent-stop-after-subagent.json'))))).toEqual(
      claudeStop('11111111-2222-4333-8444-555555555553'),
    );
  });

  it.each([
    ['an unknown event', wrapped(fixture('agent-stop.json'), 'preToolUse')],
    ['no event', JSON.stringify({ payload: fixture('agent-stop.json') })],
    ['no payload', JSON.stringify({ event: 'agentStop' })],
    ['a null envelope', 'null'],
  ])('publishes nothing for %s', (_label, body) => {
    expect(readCopilotHook(agent(body))).toEqual({ effects: [] });
  });

  it('calls unparseable JSON malformed', () => {
    expect(readCopilotHook(agent('{"event":'))).toEqual({ malformed: true, effects: [] });
  });

  it('calls a truncated body malformed', () => {
    expect(readCopilotHook(agent(wrapped(fixture('agent-stop.json')), true))).toEqual({
      malformed: true,
      effects: [],
    });
  });

  it('reads nothing on the session lane: no copilot session exists (HIVE-280)', () => {
    const input: HookInput = { ...agent(wrapped(fixture('agent-stop.json'))), lane: 'session' };

    expect(readCopilotHook(input)).toEqual({ effects: [] });
  });
});
