import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { codexAdapter } from '../../../../../electron/main/harness/codex';
import { readCodexHook } from '../../../../../electron/main/harness/codex/hooks';
import type { HookEffect, HookLane } from '../../../../../electron/main/harness/port';
import { isTaskOp, reduceTaskOp } from '../../../../../electron/main/plans/task-tools';
import type { SessionPlan } from '../../../../../electron/shared/plan-contract';

const FIXTURE = readFileSync(join(__dirname, '../../../../fixtures/codex/hooks-update-plan-0.164.0.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line !== '');

const read = (body: string, lane: HookLane = 'session', truncated = false) =>
  readCodexHook({ lane, entityId: 'sess-1', body, truncated });

const plans = (effects: HookEffect[]) => effects.filter((effect) => effect.kind === 'plan');

const post = (toolInput: unknown) =>
  JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's', cwd: '/w', tool_name: 'update_plan', tool_input: toolInput });

describe('readCodexHook', () => {
  it('is the adapter reader', () => {
    expect(codexAdapter.readHook).toBe(readCodexHook);
  });

  it('builds the main thread plan from the recorded run, in order, without the subagent', () => {
    let plan: SessionPlan | undefined;
    const seen: string[] = [];
    for (const body of FIXTURE) {
      for (const effect of plans(read(body).effects)) {
        if (effect.kind !== 'plan' || !isTaskOp(effect.update.op)) continue;
        expect(effect.update.cwd).toBe('/tmp/codex-fixture');
        plan = reduceTaskOp(plan, 'sess-1', effect.update.op);
        seen.push(plan?.tasks.map((task) => `${task.title}:${task.status}`).join(',') ?? '');
      }
    }

    expect(seen).toEqual([
      'write tests:in_progress,make them pass:pending',
      'write tests:completed,make them pass:in_progress',
      'write tests:completed,make them pass:completed',
    ]);
    expect(plan?.allDone).toBe(true);
  });

  it('keeps everything the Claude reader says', () => {
    for (const body of FIXTURE) {
      const claude = claudeCodeAdapter.readHook({ lane: 'session', entityId: 'sess-1', body, truncated: false });
      expect(read(body).effects).toEqual(expect.arrayContaining(claude.effects));
    }
  });

  it('maps steps to tasks by position, an unknown status to pending', () => {
    expect(plans(read(post({ explanation: 'x', plan: [{ step: 'a', status: 'done' }, { step: 'b', status: 'completed' }, { status: 'pending' }] })).effects)).toEqual([
      {
        kind: 'plan',
        update: {
          entityId: 'sess-1',
          cwd: '/w',
          op: {
            kind: 'tasks-replaced',
            tasks: [
              { id: '1', title: 'a', status: 'pending' },
              { id: '2', title: 'b', status: 'completed' },
            ],
          },
        },
      },
    ]);
  });

  it('reads nothing from a plan without a list', () => {
    expect(plans(read(post({ explanation: 'x' })).effects)).toEqual([]);
  });

  it('reads no plan on the agent lane', () => {
    for (const body of FIXTURE) expect(plans(read(body, 'agent').effects)).toEqual([]);
  });

  it('drops a truncated plan', () => {
    const body = post({ plan: [{ step: 'a', status: 'pending' }] });
    expect(plans(read(body.slice(0, 80), 'session', true).effects)).toEqual([]);
  });

  it('reads no plan from a PreToolUse', () => {
    const body = post({ plan: [{ step: 'a', status: 'pending' }] }).replace('PostToolUse', 'PreToolUse');
    expect(plans(read(body).effects)).toEqual([]);
  });

  it('answers a malformed body as the Claude reader does', () => {
    expect(read('{')).toEqual({ malformed: true, effects: [] });
  });
});
