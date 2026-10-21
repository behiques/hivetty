import { describe, expect, it } from 'vitest';

import { readHook } from '../../../../../electron/main/harness/claude-code/hooks';

const json = (fields: Record<string, unknown>): string => JSON.stringify(fields);
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
