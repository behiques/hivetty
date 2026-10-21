import { describe, expect, it } from 'vitest';

import { HOOK_STATUS, NOTIFICATION_TYPE_STATUS } from '@shared/hook-contract';

import { readHook } from '../../../../../electron/main/harness/claude-code/hooks';

const json = (fields: Record<string, unknown>): string => JSON.stringify(fields);
const session = (body: string, truncated = false) =>
  readHook({ lane: 'session', entityId: 'sess-07', body, truncated });
const agent = (body: string, truncated = false) =>
  readHook({ lane: 'agent', entityId: 'reviewer', body, truncated });

describe('readHook, agent lane (HIVE-236)', () => {
  it('reads Stop with the uuid and whether background work holds the process', () => {
    expect(
      agent(json({
        session_id: 'abc-1',
        hook_event_name: 'Stop',
        background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }],
      })),
    ).toEqual({
      effects: [{
        kind: 'agent',
        event: { entityId: 'reviewer', event: 'Stop', status: 'idle', sessionUuid: 'abc-1', backgroundWork: true },
      }],
    });
  });
  it('says a shell alone does not hold the process', () => {
    const reading = agent(json({
      hook_event_name: 'Stop',
      background_tasks: [{ id: 's1', type: 'shell', status: 'running' }],
    }));
    expect(reading.effects[0]).toMatchObject({ event: { backgroundWork: false } });
  });
  it('recovers the event and uuid from a truncated prefix, and nothing else', () => {
    expect(agent('{"session_id":"abc-1","hook_event_name":"Stop","tool_input":{"x":"', true)).toEqual({
      effects: [{ kind: 'agent', event: { entityId: 'reviewer', event: 'Stop', status: 'idle', sessionUuid: 'abc-1' } }],
    });
  });
  it('emits nothing for SessionEnd or an unsubscribed event', () => {
    expect(agent(json({ hook_event_name: 'SessionEnd', reason: 'other' }))).toEqual({ effects: [] });
    expect(agent(json({ hook_event_name: 'NotAnEvent' }))).toEqual({ effects: [] });
  });
  it('marks a body that does not parse', () => {
    expect(agent('{nope')).toEqual({ malformed: true, effects: [] });
  });
});

describe('readHook, session lane (HIVE-236)', () => {
  it('reads a whole PreToolUse into one status event with every field the tracker uses', () => {
    expect(session(json({
      session_id: 'u-1', hook_event_name: 'PreToolUse', cwd: '/r', tool_use_id: 't-1',
      tool_name: 'Bash', agent_id: 'ag-1', tool_input: { run_in_background: true },
    }))).toEqual({
      effects: [{ kind: 'status', event: {
        entityId: 'sess-07', event: 'PreToolUse', status: HOOK_STATUS.PreToolUse, sessionUuid: 'u-1',
        cwd: '/r', toolUseId: 't-1', toolName: 'Bash', agentId: 'ag-1', runInBackground: true,
      } }],
    });
  });
  it('keeps running shells, drops subagents quietly and reports other running kinds', () => {
    const reading = session(json({
      hook_event_name: 'SubagentStop',
      background_tasks: [
        { id: 's1', type: 'shell', status: 'running' },
        { id: 's2', type: 'shell', status: 'completed' },
        { id: 'a1', type: 'subagent', status: 'running' },
        { id: 'm1', type: 'monitor', status: 'running' },
      ],
    }));
    expect(reading.effects).toEqual([{ kind: 'status', event: {
      entityId: 'sess-07', event: 'SubagentStop', status: HOOK_STATUS.SubagentStop, backgroundShells: ['s1'],
    } }]);
    expect(reading.unknownTaskTypes).toEqual(['monitor']);
  });
  it('recovers event, cwd, tool name and uuid from a truncated prefix', () => {
    expect(session('{"session_id":"abc-1","cwd":"/r","hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"content":"', true))
      .toEqual({ effects: [{ kind: 'status', event: {
        entityId: 'sess-07', event: 'PreToolUse', status: HOOK_STATUS.PreToolUse,
        sessionUuid: 'abc-1', cwd: '/r', toolName: 'Write',
      } }] });
  });
  it('turns SessionEnd{clear} into cleared and every other SessionEnd into nothing', () => {
    expect(session(json({ hook_event_name: 'SessionEnd', reason: 'clear' }))).toEqual({ effects: [{ kind: 'cleared' }] });
    expect(session('{"hook_event_name":"SessionEnd","reason":"clear","x":"', true)).toEqual({ effects: [{ kind: 'cleared' }] });
    expect(session(json({ hook_event_name: 'SessionEnd', reason: 'logout' }))).toEqual({ effects: [] });
  });
  it('reads a recognised Notification with its own status and type, even truncated', () => {
    expect(session('{"session_id":"abc-1","cwd":"/r","hook_event_name":"Notification","notification_type":"permission_prompt","message":"', true))
      .toEqual({ effects: [{ kind: 'status', event: {
        entityId: 'sess-07', event: 'Notification', status: NOTIFICATION_TYPE_STATUS.permission_prompt,
        notificationType: 'permission_prompt', cwd: '/r', sessionUuid: 'abc-1',
      } }] });
  });
  it('emits nothing for an unrecognised Notification or an unsubscribed event', () => {
    expect(session(json({ hook_event_name: 'Notification', notification_type: 'auth_success' }))).toEqual({ effects: [] });
    expect(session(json({ hook_event_name: 'NotAnEvent' }))).toEqual({ effects: [] });
  });
  it('marks a body that does not parse', () => {
    expect(session('not json')).toEqual({ malformed: true, effects: [] });
  });
});
