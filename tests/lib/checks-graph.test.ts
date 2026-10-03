import { describe, expect, it } from 'vitest';

import { classifyLogLine, foldPushes, jobState, timeText, worst } from '@/lib/checks-graph';
import type { WorkflowRun } from '@shared/github-contract';

const run = (over: Partial<WorkflowRun>): WorkflowRun => ({
  id: 1, number: 1, attempt: 1, status: 'completed', conclusion: 'success', headSha: 'a', event: 'push',
  workflowName: 'CI', createdAt: '2026-10-03T14:00:00Z', updatedAt: '2026-10-03T14:01:00Z', url: 'u', ...over,
});

describe('jobState', () => {
  it.each([
    ['completed', 'success', 'passed'], ['completed', 'failure', 'failed'], ['completed', 'cancelled', 'failed'],
    ['completed', 'timed_out', 'failed'], ['completed', 'skipped', 'skipped'], ['completed', 'neutral', 'skipped'],
    ['in_progress', null, 'running'], ['queued', null, 'waiting'], ['waiting', null, 'waiting'], ['pending', null, 'waiting'],
  ] as const)('%s + %s is %s', (status, conclusion, state) => {
    expect(jobState(status, conclusion)).toBe(state);
  });

  it('ranks failed over running over waiting over passed over skipped', () => {
    expect(worst(['passed', 'running', 'failed'])).toBe('failed');
    expect(worst(['passed', 'waiting'])).toBe('waiting');
    expect(worst(['skipped', 'passed'])).toBe('passed');
  });
});

describe('foldPushes', () => {
  it('folds runs by head sha, oldest push first, at most eight', () => {
    const runs = Array.from({ length: 10 }, (_, i) => run({ id: 10 - i, number: 10 - i, headSha: `s${String(10 - i)}` }));
    const pushes = foldPushes(runs);
    expect(pushes.map((p) => p.sha)).toEqual(['s3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']);
  });

  it('takes the worst state across a push’s workflows, and the failing run’s number', () => {
    const [push] = foldPushes([
      run({ id: 2, number: 2208, workflowName: 'Preview', headSha: 'x' }),
      run({ id: 1, number: 2207, conclusion: 'failure', headSha: 'x', createdAt: '2026-10-03T13:59:00Z' }),
    ]);
    expect(push).toMatchObject({ sha: 'x', number: 2207, state: 'failed', startedAt: '2026-10-03T13:59:00Z' });
    expect(push?.runs).toHaveLength(2);
  });

  it('calls a push with a run in flight running', () => {
    expect(foldPushes([run({ status: 'queued', conclusion: null })])[0]?.state).toBe('running');
  });
});

describe('timeText', () => {
  const now = Date.parse('2026-10-03T14:05:00Z');
  it.each([
    ['passed', '2026-10-03T14:00:00Z', '2026-10-03T14:00:38Z', '38s'],
    ['failed', '2026-10-03T14:00:00Z', '2026-10-03T14:03:10Z', 'failed · 3m 10s'],
    ['running', '2026-10-03T14:02:46Z', null, 'running · 2m 14s'],
    ['waiting', null, null, 'waits'],
    ['skipped', null, null, 'skipped'],
    ['failed', null, null, 'failed'],
  ] as const)('%s from %s to %s reads %s', (state, start, end, text) => {
    expect(timeText(state, start, end, now)).toBe(text);
  });
});

describe('classifyLogLine', () => {
  it.each([
    ['  ✓ accepts a corporation (41 ms)', 'muted'],
    ['Tests: 1 failed, 46 passed, 47 total', 'muted'],
    ['  ✕ rejects a Delaware LLC (88 ms)', 'fail'],
    ['FAIL test/integration/fee-rule.spec.ts', 'fail'],
    ['##[error]Process completed with exit code 1.', 'fail'],
    ['    > 84 |     .toBe(422);', 'fail'],
    ['    expect(received).toBe(expected)', 'plain'],
  ] as const)('%s is %s', (line, tone) => {
    expect(classifyLogLine(line)).toBe(tone);
  });
});
