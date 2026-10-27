// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HOOK_HEADER_SESSION, HOOK_HEADER_TOKEN } from '../../../../electron/shared/hook-contract';
import { CH } from '../../../../electron/shared/ipc-contract';
import type { HiveNotification } from '../../../../electron/shared/notification-contract';
import type { PlanUpdate } from '../../../../electron/shared/plan-contract';
import { createHarnessRegistry } from '../../../../electron/main/harness/registry';
import { createReceiver, type Receiver } from '../../../../electron/main/hooks/receiver';
import { createStatusTracker } from '../../../../electron/main/hooks/tracker';
import { createNotificationHub, createNotifier } from '../../../../electron/main/notifications';

/**
 * A Codex session's own hook bodies (HIVE-279), recorded from a real 0.164 TUI in
 * `tests/fixtures/codex/interactive-0.164/`, through the real receiver. No production change was
 * needed for this: `harnessOf` answers `codex`, so `readCodexHook` reads them, and it is Claude's
 * reader plus `update_plan`. The tracker and notifier are the ones `sessions/index.ts` drives.
 */
const SESSION = 'sess-cx';
const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../../fixtures/codex/interactive-0.164', `hooks-${name}.json`), 'utf8');

describe('a codex session’s hooks through the receiver (HIVE-279)', () => {
  let receiver: Receiver;
  let url: string;
  let statuses: Array<{ status: string; signal: unknown }>;
  let raised: HiveNotification[];
  let plans: PlanUpdate[];

  beforeEach(async () => {
    statuses = [];
    raised = [];
    plans = [];
    const tracker = createStatusTracker();
    const hub = createNotificationHub({
      prefs: () => ({}),
      present: () => {},
      broadcast: (n) => raised.push(n),
      activate: () => undefined,
      announceRead: () => undefined,
      announceBadge: () => {},
      announceDismissed: () => undefined,
      now: () => Date.now(),
    });
    const notifier = createNotifier({ hub, isForeground: () => false, isForegroundEverywhere: () => false });

    receiver = createReceiver({
      knowsSession: (id) => id === SESSION,
      knowsAgent: () => false,
      onAgentEvent: () => {},
      harnesses: createHarnessRegistry({ sessionHarness: (id) => (id === SESSION ? 'codex' : undefined) }),
      onEvent: (e) => {
        const derived = tracker.apply({
          entityId: e.entityId,
          signal: e.signal,
          ...(e.toolUseId === undefined ? {} : { toolUseId: e.toolUseId }),
          ...(e.toolName === undefined ? {} : { toolName: e.toolName }),
        });
        const event = { entityId: e.entityId, status: derived.status, signal: e.signal };
        statuses.push(event);
        notifier.observe(CH.sessionStatus, event as unknown as Record<string, unknown>);
      },
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
    await receiver.stop();
  });

  const post = (body: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOOK_HEADER_TOKEN]: receiver.tokenFor(SESSION),
        [HOOK_HEADER_SESSION]: SESSION,
      },
      body,
    });

  it('reads a submitted prompt as working', async () => {
    await post(fixture('user-prompt-submit'));

    expect(statuses.at(-1)?.status).toBe('working');
  });

  it('reads a permission request as waiting on a permission, and raises it', async () => {
    await post(fixture('user-prompt-submit'));
    await post(fixture('permission-request'));

    expect(statuses.at(-1)).toMatchObject({ status: 'waiting', signal: { kind: 'waiting', reason: 'permission' } });
    expect(raised.length).toBeGreaterThan(0);
  });

  it('reads a Stop as the turn’s end, and idle', async () => {
    await post(fixture('user-prompt-submit'));
    await post(fixture('stop'));

    expect(statuses.at(-1)).toMatchObject({ status: 'idle', signal: { kind: 'turn-end' } });
  });

  it('turns update_plan into the plan, steps in order', async () => {
    await post(fixture('post-tool-use-update-plan'));

    const replaced = plans.filter((update) => update.op.kind === 'tasks-replaced');
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({
      entityId: SESSION,
      op: {
        kind: 'tasks-replaced',
        tasks: [
          { title: 'A', status: 'in_progress' },
          { title: 'B', status: 'pending' },
        ],
      },
    });
  });
});
