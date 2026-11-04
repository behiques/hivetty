// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOOK_HEADER_SESSION, HOOK_HEADER_TOKEN } from '../../../../electron/shared/hook-contract';
import type { PlanUpdate } from '../../../../electron/shared/plan-contract';
import { createHarnessRegistry } from '../../../../electron/main/harness/registry';
import { createReceiver, type Receiver } from '../../../../electron/main/hooks/receiver';

/**
 * A Copilot session's recorded `sql` call (HIVE-361), wrapped as the hook command wraps it, through
 * the real receiver and registry: `harnessOf` answers `copilot`, so `readCopilotHook` reads it and
 * the session's own `session.db`, the one that call left behind, becomes the plan.
 */
const SESSION = 'sess-cop';
const LIVE = join(__dirname, '../../../fixtures/copilot/interactive-1.0.105');

describe('a copilot session’s sql todo list through the receiver (HIVE-361)', () => {
  let receiver: Receiver;
  let url: string;
  let plans: PlanUpdate[];

  beforeEach(async () => {
    plans = [];
    receiver = createReceiver({
      knowsSession: (id) => id === SESSION,
      knowsAgent: () => false,
      onAgentEvent: () => {},
      harnesses: createHarnessRegistry({ sessionHarness: (id) => (id === SESSION ? 'copilot' : undefined) }),
      onEvent: () => {},
      onPlan: (update) => plans.push(update),
      onTicketIntent: () => undefined,
      onPromptName: () => {},
      onCleared: () => undefined,
      onDone: () => {},
      onReady: () => {},
      onMetrics: () => {},
      onLedgerRead: () => ({ entries: [], openAsks: [], claims: {} }),
      onLedgerPost: () => ({ ok: false as const, status: 503, reason: 'not exercised by this test' }),
      onAgentsList: () => Promise.reject(new Error('not exercised by this test')),
    });
    const started = await receiver.start();
    expect(started).not.toBeNull();
    url = started as string;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await receiver.stop();
  });

  it('turns the sql call into the whole todo list, steps in order', async () => {
    const payload = JSON.parse(readFileSync(join(LIVE, 'post-tool-use-sql-update.json'), 'utf8')) as { sessionId: string };
    const home = mkdtempSync(join(tmpdir(), 'cop-recv-'));
    mkdirSync(join(home, 'session-state', payload.sessionId), { recursive: true });
    copyFileSync(join(LIVE, 'session-todos.db'), join(home, 'session-state', payload.sessionId, 'session.db'));
    vi.stubEnv('COPILOT_HOME', home);

    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOOK_HEADER_TOKEN]: receiver.tokenFor(SESSION),
        [HOOK_HEADER_SESSION]: SESSION,
      },
      body: JSON.stringify({ event: 'postToolUse', payload }),
    });

    expect(plans).toEqual([
      {
        entityId: SESSION,
        cwd: '/tmp/copilot-fixture/work',
        op: {
          kind: 'tasks-replaced',
          tasks: [
            { id: '1', title: 'Alpha', status: 'completed' },
            { id: '2', title: 'Beta', status: 'pending' },
            { id: '3', title: 'Gamma', status: 'pending' },
          ],
        },
      },
    ]);
  });
});
