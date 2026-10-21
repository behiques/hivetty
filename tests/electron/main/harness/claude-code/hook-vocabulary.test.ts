import { describe, expect, it } from 'vitest';

import {
  HOOK_EVENTS,
  hookContextReply,
  noticeSignal,
  toSignal,
} from '../../../../../electron/main/harness/claude-code/hook-vocabulary';

describe('hook contract', () => {
  it('types the context reply a hook may carry (HIVE-138)', () => {
    expect(hookContextReply('entry a12 in full')).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'entry a12 in full',
      },
    });
  });

  it('subscribes the events the tracker needs', () => {
    for (const event of ['PreToolUse', 'SubagentStart', 'SubagentStop'] as const) {
      expect(HOOK_EVENTS).toContain(event);
    }
  });

});

describe('the signal table (HIVE-237)', () => {
  it.each([
    ['SessionStart', undefined, { kind: 'session-start' }],
    ['UserPromptSubmit', undefined, { kind: 'prompt' }],
    ['PreToolUse', 'Bash', { kind: 'tool-start' }],
    ['PostToolUse', 'Bash', { kind: 'tool-end' }],
    ['PermissionRequest', 'AskUserQuestion', { kind: 'waiting', reason: 'question' }],
    ['PermissionRequest', 'Bash', { kind: 'waiting', reason: 'permission' }],
    ['PermissionRequest', undefined, { kind: 'waiting', reason: 'permission' }],
    ['Elicitation', undefined, { kind: 'waiting', reason: 'input' }],
    ['Elicitation', 'AskUserQuestion', { kind: 'waiting', reason: 'input' }],
    ['SubagentStart', undefined, { kind: 'subagent-start' }],
    ['SubagentStop', undefined, { kind: 'subagent-end' }],
    ['Stop', undefined, { kind: 'turn-end' }],
  ] as const)('maps %s (tool %s) to %j', (event, toolName, signal) => {
    expect(toSignal(event, toolName)).toEqual(signal);
  });

  it.each([
    ['idle_prompt', { kind: 'notice', reason: 'idle' }],
    ['permission_prompt', { kind: 'notice', reason: 'permission' }],
    ['auth_success', undefined],
    ['constructor', undefined],
    [undefined, undefined],
  ] as const)('maps Notification %s to %j', (type, signal) => {
    expect(noticeSignal(type)).toEqual(signal);
  });

  it('maps every subscribed event but SessionEnd', () => {
    for (const event of HOOK_EVENTS) {
      if (event === 'SessionEnd') continue;
      const signal = event === 'Notification' ? noticeSignal('idle_prompt') : toSignal(event);
      expect(signal).toBeDefined();
    }
  });
});
