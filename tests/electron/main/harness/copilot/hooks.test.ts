import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { readCopilotHook } from '../../../../../electron/main/harness/copilot/hooks';
import type { HookInput, HookReading } from '../../../../../electron/main/harness/port';
import { createStatusTracker } from '../../../../../electron/main/hooks/tracker';

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
});

const LIVE = join(__dirname, '../../../../fixtures/copilot/interactive-1.0.105');
const tui = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(LIVE, name), 'utf8')) as Record<string, unknown>;
const session = (body: string): HookInput => ({ lane: 'session', entityId: 'cop-sess', body, truncated: false });
const claude = (body: Record<string, unknown>) => claudeCodeAdapter.readHook(session(JSON.stringify(body)));

/** Feeds each reading's status effects to a real tracker, and answers its last derived status. */
const track = (...readings: HookReading[]) => {
  const tracker = createStatusTracker();
  let last: ReturnType<typeof tracker.apply> | undefined;
  for (const reading of readings) {
    for (const effect of reading.effects) if (effect.kind === 'status') last = tracker.apply(effect.event);
  }
  return { last, held: tracker.held('cop-sess') };
};

describe('readCopilotHook, session lane (HIVE-280)', () => {
  it.each([
    ['sessionStart', 'session-start.json', 'SessionStart'],
    ['userPromptSubmitted', 'user-prompt-submitted.json', 'UserPromptSubmit'],
    ['agentStop', 'agent-stop.json', 'Stop'],
  ])('reads %s (%s) as Claude %s', (event, file, name) => {
    const payload = tui(file);
    expect(readCopilotHook(session(wrapped(payload, event)))).toEqual(
      claude({
        hook_event_name: name,
        session_id: payload['sessionId'],
        cwd: payload['cwd'],
        ...(payload['prompt'] === undefined ? {} : { prompt: payload['prompt'] }),
        ...(payload['source'] === undefined ? {} : { source: payload['source'] }),
      }),
    );
  });

  it('raises a permission block from permissionRequest, with no tool_use_id so the tracker clears it by name', () => {
    const payload = tui('permission-request-bash.json');
    const reading = readCopilotHook(session(wrapped(payload, 'permissionRequest')));
    expect(reading).toEqual(
      claude({
        hook_event_name: 'PermissionRequest',
        session_id: payload['sessionId'],
        cwd: payload['cwd'],
        tool_name: 'bash',
        tool_input: payload['toolInput'],
      }),
    );
    expect(reading.effects.some((effect) => effect.kind === 'status')).toBe(true);
  });

  it('clears it from postToolUse with the same tool name', () => {
    const payload = tui('post-tool-use-bash.json');
    expect(readCopilotHook(session(wrapped(payload, 'postToolUse')))).toEqual(
      claude({
        hook_event_name: 'PostToolUse',
        session_id: payload['sessionId'],
        cwd: payload['cwd'],
        tool_name: 'bash',
        tool_input: payload['toolArgs'],
      }),
    );
    const request = readCopilotHook(session(wrapped(tui('permission-request-bash.json'), 'permissionRequest')));
    expect(track(request).held.blocked).toBe(1);
    expect(track(request, readCopilotHook(session(wrapped(payload, 'postToolUse')))).held.blocked).toBe(0);
  });

  it.each([
    ['create', 'permission-request-create.json', 'post-tool-use-create.json'],
    ['apply_patch', 'permission-request-edit.json', 'post-tool-use-apply-patch.json'],
  ])("spells a %s write as the permission kind 'edit', so the write clears its own card", (_tool, request, done) => {
    const asked = readCopilotHook(session(wrapped(tui(request), 'permissionRequest')));
    const wrote = readCopilotHook(session(wrapped(tui(done), 'postToolUse')));
    const names = [asked, wrote].map(
      (reading) => reading.effects.find((effect) => effect.kind === 'status')?.event.toolName,
    );
    expect(names).toEqual(['edit', 'edit']);
    expect(track(asked, wrote).held.blocked).toBe(0);
  });

  it("does not clear an edit block from a bash call's postToolUse", () => {
    const asked = readCopilotHook(session(wrapped(tui('permission-request-edit.json'), 'permissionRequest')));
    const ran = readCopilotHook(session(wrapped(tui('post-tool-use-bash.json'), 'postToolUse')));
    expect(track(asked, ran).held.blocked).toBe(1);
  });

  it("ignores a subagent's agentStop in a session too", () => {
    expect(readCopilotHook(session(wrapped(fixture('agent-stop-subagent.json'))))).toEqual({ effects: [] });
  });

  it('reads an unknown event as nothing, and a broken body as malformed', () => {
    expect(readCopilotHook(session(wrapped(tui('agent-stop.json'), 'preCompact')))).toEqual({ effects: [] });
    expect(readCopilotHook(session(JSON.stringify({ event: 'agentStop', payload: 'x' })))).toEqual({ effects: [] });
    expect(readCopilotHook(session('{nope'))).toEqual({ malformed: true, effects: [] });
    expect(readCopilotHook({ ...session('{}'), truncated: true })).toEqual({ malformed: true, effects: [] });
  });

  it("raises a question block from an ask_user dialog, read as Claude's AskUserQuestion (FINDINGS P2)", () => {
    const payload = tui('notification-elicitation_dialog.json');
    const reading = readCopilotHook(session(wrapped(payload, 'notification')));
    expect(reading).toEqual(
      claude({
        hook_event_name: 'PermissionRequest',
        session_id: payload['sessionId'],
        cwd: payload['cwd'],
        tool_name: 'AskUserQuestion',
      }),
    );
    expect(reading.effects.find((effect) => effect.kind === 'status')?.event.signal).toEqual({
      kind: 'waiting',
      reason: 'question',
    });
  });

  it("clears the question from ask_user's postToolUse once answered", () => {
    const asked = readCopilotHook(session(wrapped(tui('notification-elicitation_dialog.json'), 'notification')));
    const answered = readCopilotHook(session(wrapped(tui('post-tool-use-ask-user.json'), 'postToolUse')));
    expect(track(asked).held.blocked).toBe(1);
    expect(track(asked, answered).held.blocked).toBe(0);
  });

  it('reads a permission_prompt notification as nothing: permissionRequest already raised the card', () => {
    expect(
      readCopilotHook(session(wrapped(tui('notification-permission_prompt.json'), 'notification'))),
    ).toEqual({ effects: [] });
  });

  it('reads no notification on the agent lane', () => {
    expect(readCopilotHook(agent(wrapped(tui('notification-elicitation_dialog.json'), 'notification')))).toEqual({
      effects: [],
    });
  });

  it('reads nothing on any other lane', () => {
    expect(readCopilotHook({ ...session(wrapped(tui('agent-stop.json'))), lane: 'fence' as never })).toEqual({
      effects: [],
    });
  });
});
