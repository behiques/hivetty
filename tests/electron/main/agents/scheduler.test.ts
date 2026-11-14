// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createScheduler, mootCards, triggerFor } from '../../../../electron/main/agents/scheduler';
import { createAgentState } from '../../../../electron/main/agents/state';
import {
  AGENT_PENDING_WAKE_MAX,
  dayKey,
  type WakeSpec,
} from '../../../../electron/shared/agent-contract';
import type { HarnessId } from '../../../../electron/shared/harness-contract';
import {
  LEDGER_ASK_TTL_MS,
  type LedgerEntry,
  type LedgerPostRequest,
} from '../../../../electron/shared/ledger-contract';
import { askStates } from '../../../../electron/shared/ledger-derive';
import {
  CARD_AFTER_MS,
  QUIET_LANE_FALLBACK_MS,
  QUIET_RUN_MS,
  RENUDGE_AFTER_MS,
  type LiveRun,
} from '../../../../electron/main/ledger/watchdog';

const AGENT = 'pr-reviewer';

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'a1',
  ts: 0,
  from: 'overmind',
  to: AGENT,
  kind: 'ask',
  body: 'take a look?',
  ...over,
});

describe('createScheduler', () => {
  let woke: { name: string; trigger: string; extra?: string; job?: true; lane?: string }[];
  let wakeIds: (readonly string[] | undefined)[];
  let delivered: (string | undefined)[];
  let entries: LedgerEntry[];
  let appended: LedgerPostRequest[];
  let asksFromList: string[] | undefined;
  let clock: number;
  let timers: Map<number, () => void>;
  let nextTimerId: number;
  let wakesOnLedger: boolean;
  let appendOk: boolean;
  let state: ReturnType<typeof createAgentState>;
  let scheduler: ReturnType<typeof createScheduler>;
  /** What `scheduleFor` answers. Empty means "no usable definition". */
  let schedules: Map<string, { wake: WakeSpec; dailyUsd?: number; mcp?: string[] }>;
  /**
   * Makes `run` answer a refusal, as `RunTracker` does for a working agent.
   *
   * A reason rather than a bare boolean since HIVE-126: `manualWake` waits for
   * `working` and `paused` and reports the rest, so a fake that could not say
   * which it was could not drive that difference.
   */
  let refuse: 'working' | 'paused' | 'saturated' | 'invalid' | 'cli' | 'budget' | false;
  /** The `reason` a refusal carries, as `RunTracker` gives one for `invalid`. */
  let refuseReason: string | undefined;
  /** The CLI a `cli` refusal names (HIVE-399). */
  let refuseCli: HarnessId | undefined;
  /** Whether a refusal says live runs hold the budget (HIVE-412). */
  let refuseHold: boolean;
  /**
   * Refuses `'saturated'` on the one `run` call whose zero-based index
   * matches, and lets every other call through (HIVE-128). What `flush`'s
   * per-job fan-out needs that `refuse` cannot give it: `refuse` is all-or-
   * nothing, and proving "put it back, and the ones behind it" back needs the
   * first job to land and a later one to be turned away.
   */
  let refuseAfter: number | undefined;
  /** How many times `run` has been called this test, for {@link refuseAfter}. */
  let runCalls: number;
  /** What `parallelFor` answers — `limits.parallel`, from Task 6's cache. */
  let parallel: number;
  /** Whether the registry has answered its first listing yet. */
  let listed: boolean;
  /** Names pushed to the renderer, in order. */
  let pushed: string[];
  /** How many entries the standing queue held at each push, in order (HIVE-411). */
  let queuedAtPush: number[];
  /** What `laneOf` answers (HIVE-186). Undefined: a pre-lane agent. */
  let laneMode: 'thread' | 'repo' | undefined;
  /** Lanes the fake tracker reports live. Null: omit `laneLive`, the pre-lane harness. */
  let liveLanes: Set<string> | null;
  /** Re-enter `onRunClosed` from inside `run`, as a synchronous spawn failure does (HIVE-186). */
  let reenter: boolean;
  /** Lane directories the scheduler asked to remove, as `<agent>:<lane>` (HIVE-188). */
  let removed: string[];
  /** HIVE-267: what the injected licence gate answers. */
  let lapsed: boolean;
  /** Sessions the watchdog asked delivery to flush (HIVE-411). */
  let flushed: string[];
  /** Every live run, as the tracker would answer (HIVE-411). */
  let live: LiveRun[];
  /** HIVE-409: what the injected PR-merged lookup answers. */
  let prMergedFn: ReturnType<typeof vi.fn<(repo: string, n: number) => Promise<boolean | undefined>>>;

  /** Fire every armed interval once — the sweep and the schedule tick. */
  const tick = (): void => {
    for (const handler of [...timers.values()]) handler();
  };

  const build = (): ReturnType<typeof createScheduler> =>
    createScheduler({
      run: (name, trigger, extra, options) => {
        const call = runCalls;

        runCalls += 1;

        if (reenter) scheduler.onRunClosed(name);
        if (refuseAfter === call) return { started: false, refused: 'saturated' };
        if (refuse !== false) {
          return {
            started: false,
            refused: refuse,
            ...(refuseReason === undefined ? {} : { reason: refuseReason }),
            ...(refuseCli === undefined ? {} : { cli: refuseCli }),
            ...(refuseHold ? { hold: true as const } : {}),
          };
        }
        if (liveLanes?.has(options?.lane ?? 'standing') === true) return { started: false, refused: 'working' };

        wakeIds.push(options?.wakes);
        delivered.push(options?.delivered);
        woke.push({
          name,
          trigger,
          ...(extra === undefined ? {} : { extra }),
          ...(options?.job === true ? { job: true } : {}),
          ...(options?.lane === undefined ? {} : { lane: options.lane }),
        });
        return { started: true, run: 'run-1', kind: 'standing' };
      },
      state,
      isAgent: (id) => id === AGENT,
      wakesOnLedger: () => wakesOnLedger,
      parallelFor: () => parallel,
      laneOf: () => laneMode,
      asksFrom: () => asksFromList,
      removeLaneDir: (name, lane) => {
        removed.push(`${name}:${lane}`);
      },
      ...(liveLanes === null ? {} : { laneLive: (_name: string, lane: string) => liveLanes?.has(lane) === true }),
      schedules: () => (listed ? schedules : undefined),
      pushStatus: (name) => {
        pushed.push(name);
        queuedAtPush.push((state.read(name).pendingWake ?? []).length);
      },
      ledger: {
        read: () => ({ entries }),
        append: (request) => {
          appended.push(request);
          return { ok: appendOk };
        },
      },
      now: () => clock,
      lapsed: () => lapsed,
      prMerged: (repo, n) => prMergedFn(repo, n),
      flushSession: (id) => {
        flushed.push(id);
      },
      liveRuns: () => live,
      setIntervalFn: ((handler: () => void) => {
        const id = nextTimerId;
        nextTimerId += 1;
        timers.set(id, handler);
        return id;
      }) as unknown as typeof setInterval,
      clearIntervalFn: ((id: number) => {
        timers.delete(id);
      }) as unknown as typeof clearInterval,
    });

  beforeEach(() => {
    woke = [];
    wakeIds = [];
    delivered = [];
    entries = [];
    appended = [];
    asksFromList = undefined;
    clock = 0;
    timers = new Map();
    nextTimerId = 1;
    wakesOnLedger = true;
    appendOk = true;
    schedules = new Map();
    refuse = false;
    refuseReason = undefined;
    refuseCli = undefined;
    refuseHold = false;
    refuseAfter = undefined;
    runCalls = 0;
    parallel = 1;
    listed = true;
    pushed = [];
    queuedAtPush = [];
    laneMode = undefined;
    liveLanes = null;
    reenter = false;
    removed = [];
    lapsed = false;
    flushed = [];
    live = [];
    prMergedFn = vi.fn(async (_repo: string, _n: number) => undefined as boolean | undefined);
    state = createAgentState({ path: '/dev/null/agents.json', debounceMs: 1 });
    state.patch(AGENT, { status: 'sleeping' });

    scheduler = build();
  });

  it('wakes a sleeping agent at once, naming the entry', () => {
    scheduler.onEntry(entry());

    expect(woke).toEqual([
      { name: AGENT, trigger: 'ledger', extra: 'ask a1 from overmind' },
    ]);
  });

  /*
    Retro C: an ask with `meta.after: "owner/repo#N"` waits for that PR's
    `closed` entry. Released once, with a `released` event as the dedup, so a
    restart routes one released while the app was down and nothing twice.
  */
  describe('wakes (HIVE-410)', () => {
    it('names the routed entry', () => {
      scheduler.onEntry(entry());

      expect(wakeIds).toEqual([['a1']]);
    });

    it('names every flushed ledger entry, in order, and not a queued manual run', () => {
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [
          { kind: 'manual', id: 'run', from: 'overmind' },
          { kind: 'ask', id: 'a1', from: 'overmind' },
          { kind: 'answer', id: 'a2', from: 'sess-2' },
        ],
      });

      scheduler.onRunClosed(AGENT);

      expect(wakeIds).toEqual([['a1', 'a2']]);
    });

    it('names nothing for a manual run', () => {
      scheduler.manualWake(AGENT);

      expect(wakeIds).toEqual([undefined]);
    });
  });

  describe('delivered (HIVE-412)', () => {
    it('hands the run the routed entry, rendered from the log', () => {
      entries = [entry({ ref: 'a1', body: 'please look at #9', meta: { pr: 9 } })];

      scheduler.onEntry(entries[0] as LedgerEntry);

      expect(delivered[0]).toContain('--- ask a1 from overmind (thread a1) ---\nmeta: {"pr":9}\nplease look at #9');
    });

    it('hands a flush every ledger entry it wakes for, in order', () => {
      entries = [
        entry({ id: 'a1', ref: 'a1', body: 'first' }),
        entry({ id: 'a2', kind: 'answer', from: 'sess-2', thread: 'a1', body: 'second' }),
      ];
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [
          { kind: 'ask', id: 'a1', from: 'overmind' },
          { kind: 'answer', id: 'a2', from: 'sess-2' },
        ],
      });

      scheduler.onRunClosed(AGENT);

      const block = delivered[0] ?? '';
      expect(block.indexOf('first')).toBeGreaterThan(-1);
      expect(block.indexOf('first')).toBeLessThan(block.indexOf('second'));
    });

    it('hands a re-wake the ask it owes', () => {
      entries = [
        entry({ id: 'k1', from: 'sess-1', body: 'Ship PR #1' }),
        entry({ id: 'w1', from: 'overmind', kind: 'post', thread: 'k1', body: 'You owe an answer to k1', meta: { rewoke: 'k1' } }),
      ];

      scheduler.start();

      expect(delivered[0]).toContain('You still owe an answer to ask k1:');
    });

    it('hands no block for a manual run', () => {
      scheduler.manualWake(AGENT);

      expect(delivered).toEqual([undefined]);
    });

    it('hands no block for an entry the log no longer has', () => {
      scheduler.onEntry(entry());

      expect(delivered).toEqual([undefined]);
    });
  });

  describe('asks_from (HIVE-412)', () => {
    const refusals = () => appended.filter((request) => request.kind === 'answer' && request.from === 'overmind');

    it('answers a new ask from an unlisted party on its thread, and wakes nobody', () => {
      asksFromList = ['builder'];

      scheduler.onEntry(entry({ id: 'k9', from: 'sess-9' }));

      expect(woke).toEqual([]);
      expect(refusals()).toEqual([
        {
          from: 'overmind',
          to: 'sess-9',
          kind: 'answer',
          thread: 'k9',
          body: 'pr-reviewer does not take asks from sess-9; it takes them from builder and overmind.',
        },
      ]);
    });

    it('wakes for a listed party, a session under sess-*, the overmind and itself', () => {
      asksFromList = ['builder', 'sess-*'];

      scheduler.onEntry(entry({ id: 'k1', from: 'builder' }));
      scheduler.onRunClosed(AGENT);
      scheduler.onEntry(entry({ id: 'k2', from: 'sess-3f2' }));
      scheduler.onRunClosed(AGENT);
      scheduler.onEntry(entry({ id: 'k3' }));

      expect(woke).toHaveLength(3);
      expect(refusals()).toEqual([]);
    });

    it('never filters an answer', () => {
      asksFromList = [];

      scheduler.onEntry(entry({ id: 'n1', kind: 'answer', from: 'acr', thread: 'k0' }));

      expect(woke).toHaveLength(1);
      expect(refusals()).toEqual([]);
    });

    it('wakes for a threaded ask from an unlisted party on a thread the agent opened', () => {
      asksFromList = [];
      const threaded = entry({ id: 'k2', from: 'acr', thread: 'k1' });
      entries = [entry({ id: 'k1', from: AGENT, to: 'acr' }), threaded];

      scheduler.onEntry(threaded);

      expect(woke).toHaveLength(1);
      expect(refusals()).toEqual([]);
    });

    it('refuses a threaded ask from an unlisted party on a thread the agent is not a party to', () => {
      asksFromList = [];
      const threaded = entry({ id: 'k2', from: 'acr', thread: 'k1' });
      entries = [entry({ id: 'k1', from: 'sess-1', to: 'builder' }), threaded];

      scheduler.onEntry(threaded);

      expect(woke).toEqual([]);
      expect(refusals()).toHaveLength(1);
    });

    it('takes asks from anyone when the definition names no list', () => {
      scheduler.onEntry(entry({ id: 'k1', from: 'acr' }));

      expect(woke).toHaveLength(1);
    });
  });

  describe('a held ask (meta.after)', () => {
    const held = entry({ id: 'h1', meta: { after: 'a/b#3' } });
    const closed = (pr = 3, repo = 'a/b'): LedgerEntry =>
      entry({
        id: `c${String(pr)}`,
        from: 'shipper',
        to: 'sess-4l',
        kind: 'post',
        body: 'merged',
        meta: { pr, repo, stage: 'closed' },
      });
    /** What the real ledger does with an append: it lands in the log. */
    const settle = (): void => {
      for (const request of appended.splice(0)) {
        entries.push(
          entry({ ...request, id: `ev${String(entries.length)}`, ts: clock }) as LedgerEntry,
        );
      }
    };
    const releasedEvents = (): number =>
      entries.filter((item) => item.meta?.['released'] === 'h1').length;

    it('is not routed on arrival while its PR is open', () => {
      entries.push(held);
      scheduler.onEntry(held);

      expect(woke).toEqual([]);
    });

    it("is routed once, as the ask, when its PR's closed entry lands", () => {
      entries.push(held);
      scheduler.onEntry(held);
      entries.push(closed());
      scheduler.onEntry(closed());
      settle();

      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'ask h1 from overmind' }]);
      expect(releasedEvents()).toBe(1);
    });

    it('stays held on a closed entry for another PR', () => {
      entries.push(held);
      scheduler.onEntry(held);
      entries.push(closed(4));
      scheduler.onEntry(closed(4));

      expect(woke).toEqual([]);
    });

    it('is routed at start when its PR closed while the app was down, and only once', () => {
      entries.push(held, closed());
      scheduler.start();
      settle();
      scheduler.stop();
      scheduler = build();
      scheduler.start();

      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'ask h1 from overmind' }]);
      expect(releasedEvents()).toBe(1);
    });

    it('stays held across a restart while its PR is open', () => {
      entries.push(held);
      scheduler.start();

      expect(woke).toEqual([]);
    });

    it('is routed on arrival when its PR had already closed, and never again at start', () => {
      entries.push(closed(), held);
      scheduler.onEntry(held);
      settle();
      scheduler.start();

      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'ask h1 from overmind' }]);
    });

    it('queues a released ask for a working agent', () => {
      state.patch(AGENT, { status: 'working' });
      entries.push(held, closed());
      scheduler.onEntry(closed());

      expect(woke).toEqual([]);
      expect(state.read(AGENT).pendingWake).toHaveLength(1);
    });

    it('does not wake when the released event cannot be written', () => {
      appendOk = false;
      entries.push(held, closed());
      scheduler.onEntry(closed());

      expect(woke).toEqual([]);
    });

    it('writes no released marker for an ask the agent addressed to itself', () => {
      const self = entry({ id: 'h1', from: AGENT, meta: { after: 'a/b#3' } });
      entries.push(self, closed());
      scheduler.onEntry(closed());

      expect(appended).toEqual([]);
    });
  });

  it('writes nothing for a party that is not an agent', () => {
    scheduler.onEntry(entry({ to: 'sess-3' }));

    expect(woke).toEqual([]);
  });

  it('writes nothing for a broadcast', () => {
    scheduler.onEntry(entry({ to: undefined }));

    expect(woke).toEqual([]);
  });

  /*
    Retro C, Task 4: what the fixer's own follow-up can rely on. An ask an
    agent addresses to itself never wakes it, held or not, so a blocked fixer
    cannot queue its own next round with `meta.after`; it answers `blocked-on`
    and the asker re-posts the job with `after`.
  */
  it('never wakes an agent for an ask it addressed to itself, held or released', () => {
    scheduler.onEntry(entry({ id: 's1', from: AGENT }));
    const selfHeld = entry({ id: 's2', from: AGENT, meta: { after: 'a/b#3' } });
    const closed = entry({
      id: 'c3',
      from: 'shipper',
      to: 'sess-4l',
      kind: 'post',
      meta: { pr: 3, repo: 'a/b', stage: 'closed' },
    });
    entries.push(selfHeld, closed);
    scheduler.onEntry(selfHeld);
    scheduler.onEntry(closed);

    expect(woke).toEqual([]);
  });

  it('keeps the thread and the writing run on a queued entry (HIVE-184)', () => {
    state.patch(AGENT, { status: 'working' });

    scheduler.onEntry(
      entry({ id: 'a2', kind: 'answer', from: 'overmind', thread: 'a1', meta: { run: 'run-7' } }),
    );

    expect(state.read(AGENT).pendingWake).toEqual([
      { kind: 'answer', id: 'a2', from: 'overmind', thread: 'a1', run: 'run-7' },
    ]);
  });

  it('keeps neither when the entry has none, so a pre-lane queue is byte-identical', () => {
    state.patch(AGENT, { status: 'working' });
    scheduler.onEntry(entry({ id: 'a3' }));

    expect(state.read(AGENT).pendingWake).toEqual([{ kind: 'ask', id: 'a3', from: 'overmind' }]);
  });

  it('queues while working and wakes once when the run closes', () => {
    state.patch(AGENT, { status: 'working' });

    scheduler.onEntry(entry({ id: 'a1' }));
    scheduler.onEntry(entry({ id: 'a2', kind: 'answer', from: 'sess-2' }));

    expect(woke).toEqual([]);
    expect(state.read(AGENT).pendingWake).toHaveLength(2);

    state.patch(AGENT, { status: 'sleeping' });
    scheduler.onRunClosed(AGENT);

    expect(woke).toEqual([
      {
        name: AGENT,
        trigger: 'ledger',
        extra: 'ask a1 from overmind, answer a2 from sess-2',
      },
    ]);
    expect(state.read(AGENT).pendingWake).toEqual([]);
  });

  /*
    HIVE-126. A ledger entry's body stays out of the queue because the log
    holds it and the agent re-reads it on the wake it caused. A manual run has
    no log line behind it, so the queue is the only place its words exist.
  */
  describe('a queued entry that carries its own words', () => {
    it('says them on the wake it causes', () => {
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [
          { kind: 'manual', id: 'run', from: 'overmind', text: 'review PR 1234' },
        ],
      });

      scheduler.onRunClosed(AGENT);

      expect(woke).toEqual([
        {
          name: AGENT,
          trigger: 'manual',
          extra: 'manual run from overmind — review PR 1234',
        },
      ]);
    });

    it('reports the manual trigger when a manual entry sits among ledger ones', () => {
      // A person's request is the reason with someone behind it, and `ledger`
      // would name a route the manual entry never took.
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [
          { kind: 'ask', id: 'a12', from: 'overmind' },
          { kind: 'manual', id: 'run', from: 'overmind', text: 'review PR 1234' },
        ],
      });

      scheduler.onRunClosed(AGENT);

      expect(woke).toEqual([
        {
          name: AGENT,
          trigger: 'manual',
          extra:
            'ask a12 from overmind, manual run from overmind — review PR 1234',
        },
      ]);
    });

    it('still reports the ledger trigger for a queue of ledger entries', () => {
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [{ kind: 'ask', id: 'a12', from: 'overmind' }],
      });

      scheduler.onRunClosed(AGENT);

      expect(woke[0]).toMatchObject({ trigger: 'ledger' });
    });

    it('keeps the words when a refused flush puts the queue back', () => {
      const queued = {
        kind: 'manual',
        id: 'run',
        from: 'overmind',
        text: 'review PR 1234',
      };
      state.patch(AGENT, { status: 'sleeping', pendingWake: [queued] });
      refuse = 'working';

      scheduler.onRunClosed(AGENT);

      expect(state.read(AGENT).pendingWake).toEqual([queued]);
    });
  });

  /*
    HIVE-126. The manual path used to call `RunTracker.run` directly, so a
    refusal was printed and the intent was gone — while the identical intent
    arriving through the ledger was queued and delivered later.
  */
  describe('manualWake', () => {
    it('queues a run whose CLI cannot run yet, saying which and why (HIVE-399)', () => {
      refuse = 'cli';
      refuseReason = 'codex is turned off for agents in Settings › Harnesses';
      refuseCli = 'codex';

      expect(scheduler.manualWake(AGENT)).toEqual({
        started: false,
        queued: true,
        behind: 'cli',
        reason: 'codex is turned off for agents in Settings › Harnesses',
        cli: 'codex',
      });
      expect(state.read(AGENT).pendingWake).toHaveLength(1);
    });

    it('wakes now, saying the words as the reason', () => {
      const outcome = scheduler.manualWake(AGENT, 'review PR 1234');

      expect(outcome).toEqual({ started: true, run: 'run-1', kind: 'standing' });
      expect(woke).toEqual([
        { name: AGENT, trigger: 'manual', extra: 'review PR 1234', job: true },
      ]);
    });

    it('wakes a bare run with no reason at all', () => {
      const outcome = scheduler.manualWake(AGENT);

      expect(outcome).toEqual({ started: true, run: 'run-1', kind: 'standing' });
      expect(woke).toEqual([{ name: AGENT, trigger: 'manual' }]);
    });

    it.each(['working', 'paused', 'saturated'] as const)(
      'queues a run refused because the agent is %s',
      (refused) => {
        refuse = refused;

        const outcome = scheduler.manualWake(AGENT, 'review PR 1234');

        expect(outcome).toEqual({
          started: false,
          queued: true,
          behind: refused,
        });
        expect(state.read(AGENT).pendingWake).toEqual([
          {
            kind: 'manual',
            id: 'run',
            from: 'overmind',
            text: 'review PR 1234',
          },
        ]);
      },
    );

    it('queues a bare run without inventing words for it', () => {
      refuse = 'working';

      scheduler.manualWake(AGENT);

      expect(state.read(AGENT).pendingWake).toEqual([
        { kind: 'manual', id: 'run', from: 'overmind' },
      ]);
    });

    it('reports the refusal when the queue is full rather than claiming a queue', () => {
      /*
        `enqueue` drops the newcomer at `AGENT_PENDING_WAKE_MAX`. For a ledger
        entry that is harmless — the log still holds it. Here it would print
        "queued" in dim about a run that went nowhere, and a paused agent never
        flushes, so every later run would repeat the lie.
      */
      state.patch(AGENT, {
        pendingWake: Array.from({ length: AGENT_PENDING_WAKE_MAX }, (_, i) => ({
          kind: 'ask',
          id: `a${i}`,
          from: 'overmind',
        })),
      });
      refuse = 'paused';

      const outcome = scheduler.manualWake(AGENT, 'review PR 1234');

      expect(outcome).toEqual({ started: false, refused: 'paused' });
      expect(state.read(AGENT).pendingWake).toHaveLength(AGENT_PENDING_WAKE_MAX);
    });

    it('refuses once the scheduler has stopped, rather than spawning', () => {
      /*
        `agents:run` awaits `mcp.start()` before reaching here, so a quit can
        land on that await. `scheduler.stop()` runs before `runs.closeAll()`
        precisely so nothing spawns after the tracker has finished iterating —
        and the tracker has no shutdown flag of its own to refuse on.
      */
      scheduler.stop();

      const outcome = scheduler.manualWake(AGENT, 'review PR 1234');

      expect(outcome).toMatchObject({ started: false, refused: 'unknown' });
      expect(woke).toEqual([]);
      expect(state.read(AGENT).pendingWake ?? []).toEqual([]);
    });

    it('does not queue a definition that cannot be read', () => {
      /*
        `route()` queues `invalid` because at boot it means `mcp.start()` is
        still in flight. The `agents:run` handler awaits `mcp.start()` before
        reaching here, so on this path it means a definition the user has to go
        and fix — and "queued" would be a promise nothing is going to keep.
      */
      refuse = 'invalid';

      const outcome = scheduler.manualWake(AGENT, 'review PR 1234');

      expect(outcome).toEqual({ started: false, refused: 'invalid' });
      expect(state.read(AGENT).pendingWake ?? []).toEqual([]);
    });

    it('delivers a queued manual run when the current one closes', () => {
      refuse = 'working';
      scheduler.manualWake(AGENT, 'review PR 1234');

      refuse = false;
      scheduler.onRunClosed(AGENT);

      expect(woke).toEqual([
        {
          name: AGENT,
          trigger: 'manual',
          extra: 'manual run from overmind — review PR 1234',
        },
      ]);
      expect(state.read(AGENT).pendingWake).toEqual([]);
    });

    it('delivers a queued manual run when a paused agent resumes', () => {
      refuse = 'paused';
      scheduler.manualWake(AGENT, 'review PR 1234');

      refuse = false;
      scheduler.onResume(AGENT);

      expect(woke).toHaveLength(1);
      expect(state.read(AGENT).pendingWake).toEqual([]);
    });
  });

  it('holds for a paused agent and wakes once on resume', () => {
    state.patch(AGENT, { status: 'paused' });
    scheduler.onEntry(entry());

    expect(woke).toEqual([]);
    expect(state.read(AGENT).pendingWake).toHaveLength(1);

    scheduler.onResume(AGENT);

    expect(woke).toHaveLength(1);
    expect(state.read(AGENT).pendingWake).toEqual([]);
  });

  it('does not flush a run that closed into paused — the pause outranks it', () => {
    /*
      HIVE-117 lets a pause land mid-run: the turn finishes and `finalizeRun`
      holds `paused` rather than writing its computed resting status over it.
      Flushing here would reach `RunTracker.run`'s `refused: 'paused'` and drop
      the entries on the floor, with their asks still open.
    */
    state.patch(AGENT, { status: 'working' });
    scheduler.onEntry(entry());

    state.patch(AGENT, { status: 'paused' });
    scheduler.onRunClosed(AGENT);

    expect(woke).toEqual([]);
    expect(state.read(AGENT).pendingWake).toHaveLength(1);

    scheduler.onResume(AGENT);

    expect(woke).toHaveLength(1);
  });

  it('closes a run with nothing queued without waking', () => {
    scheduler.onRunClosed(AGENT);

    expect(woke).toEqual([]);
  });

  it('resumes an agent with nothing queued without waking', () => {
    scheduler.onResume(AGENT);

    expect(woke).toEqual([]);
  });

  it('keeps the earliest entries when the queue is full', () => {
    state.patch(AGENT, { status: 'working' });

    for (let index = 0; index < AGENT_PENDING_WAKE_MAX + 5; index += 1) {
      scheduler.onEntry(entry({ id: `a${index}` }));
    }

    const queued = state.read(AGENT).pendingWake ?? [];

    expect(queued).toHaveLength(AGENT_PENDING_WAKE_MAX);
    expect(queued[0]?.id).toBe('a0');
    expect(queued.at(-1)?.id).toBe(`a${AGENT_PENDING_WAKE_MAX - 1}`);
  });

  it('clears the queue before it wakes, so a re-entrant close cannot loop', () => {
    /*
      The flush re-enters `RunTracker.run`, and a spawn that fails synchronously
      finalizes the run from inside that call — reaching `onRunClosed` again. A
      queue still standing at that moment would wake forever.
    */
    state.patch(AGENT, { status: 'working' });
    scheduler.onEntry(entry());
    state.patch(AGENT, { status: 'sleeping' });

    let reentered = 0;

    scheduler = createScheduler({
      run: (name) => {
        reentered += 1;
        if (reentered < 5) scheduler.onRunClosed(name);
        return { started: false, refused: 'working' };
      },
      state,
      isAgent: (id) => id === AGENT,
      wakesOnLedger: () => true,
      parallelFor: () => 1,
      // This spec drives `onEntry` only; the tick has nothing to read.
      schedules: () => new Map(),
      pushStatus: () => {},
      ledger: { read: () => ({ entries }), append: () => ({ ok: true }) },
      now: () => clock,
    });

    scheduler.onRunClosed(AGENT);

    expect(reentered).toBe(1);
  });

  it('flushes a queue that survived a crash', () => {
    /*
      `agents.json` is read back through `wakeFromWorking`, which rewrites
      `working` to `sleeping` because no child of the last launch survived it.
      A queue left by a crashed run has no run to close and no resume coming.
    */
    state.patch(AGENT, {
      status: 'sleeping',
      pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
    });

    scheduler.start();

    expect(woke).toEqual([
      { name: AGENT, trigger: 'ledger', extra: 'ask a9 from overmind' },
    ]);
  });

  it('leaves a paused agent queue alone at boot', () => {
    state.patch(AGENT, {
      status: 'paused',
      pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
    });

    scheduler.start();

    expect(woke).toEqual([]);
    expect(state.read(AGENT).pendingWake).toHaveLength(1);
  });

  it('wakes nobody at boot when no queue survived', () => {
    scheduler.start();

    expect(woke).toEqual([]);
  });

  it('leaves an agent alone when its definition does not take ledger wakes', () => {
    // `wake.on: [ledger]` is a gate, and the Settings copy promises it: without
    // it "a question addressed to it waits unread".
    wakesOnLedger = false;
    scheduler = build();

    scheduler.onEntry(entry());

    expect(woke).toEqual([]);
    // And nothing is queued either — a queue nothing will deliver would only
    // fire on the day its author ticks the box.
    expect(state.read(AGENT).pendingWake ?? []).toEqual([]);
  });

  describe('a refused wake tells the asker (HIVE-408)', () => {
    const asked = entry({ id: 'a26', ref: 'a26', from: 'builder', to: AGENT, kind: 'ask', body: 'ship #226' });
    const notes = () => appended.filter((a) => a.meta?.['refused'] !== undefined);

    it('posts one note on the ask\'s thread, to the asker, and keeps the ask open', () => {
      refuse = 'budget';
      entries = [asked];
      scheduler.start();
      scheduler.onEntry(asked);
      tick();
      tick();

      expect(notes()).toEqual([
        {
          from: 'overmind',
          to: 'builder',
          kind: 'post',
          thread: 'a26',
          body: `${AGENT} is out of budget until midnight; a26 is queued`,
          meta: { refused: 'budget', agent: AGENT },
        },
      ]);
      expect(state.read(AGENT).refused).toMatchObject({ reason: 'budget' });
      expect(state.read(AGENT).pendingWake).toEqual([expect.objectContaining({ id: 'a26' })]);
    });

    it('pushes the agent once the refusal is recorded, so the stall panel sees it (HIVE-411)', () => {
      refuse = 'budget';
      entries = [asked];
      scheduler.start();
      pushed = [];
      scheduler.onEntry(asked);
      tick();

      expect(state.read(AGENT).refused).toMatchObject({ reason: 'budget' });
      expect(pushed).toContain(AGENT);
    });

    it('pushes only once the refused entry is back in the queue, so the panel never reads queued: 0 (HIVE-411)', () => {
      refuse = 'budget';
      entries = [asked];
      scheduler.start();
      queuedAtPush = [];
      // The route path: refused on arrival, then queued.
      scheduler.onEntry(asked);
      // The flush path: the queue is cleared for the wake, refused, then restored.
      tick();

      expect(queuedAtPush.length).toBeGreaterThanOrEqual(2);
      expect(queuedAtPush.every((n) => n === 1)).toBe(true);
    });

    it('does not repeat a note the log already holds', () => {
      refuse = 'budget';
      entries = [
        asked,
        entry({ id: 'n1', from: 'overmind', to: 'builder', kind: 'post', thread: 'a26', body: 'x', meta: { refused: 'budget', agent: AGENT } }),
      ];
      scheduler.start();
      scheduler.onEntry(asked);
      expect(notes()).toEqual([]);
    });

    it('says nothing for a wait (working, paused) or for a post', () => {
      refuse = 'working';
      scheduler.start();
      scheduler.onEntry(asked);
      refuse = 'budget';
      scheduler.onEntry(entry({ id: 'p9', from: 'builder', to: AGENT, kind: 'post', body: 'fyi' }));
      expect(notes()).toEqual([]);
    });

    it('names the cause for cli and invalid, and clears the lane record when a run starts', () => {
      refuse = 'cli';
      refuseReason = 'claude is not signed in';
      entries = [asked];
      scheduler.start();
      scheduler.onEntry(asked);
      expect(notes().find((a) => a.meta?.['refused'] === 'cli')?.body).toBe(
        `${AGENT} cannot wake: claude is not signed in; a26 is queued`,
      );
      refuse = false;
      tick();
      expect(state.read(AGENT).refused).toBeUndefined();
    });

    it('says a hold waits on a live run, not midnight, and marks the note (HIVE-412)', () => {
      refuse = 'budget';
      refuseHold = true;
      entries = [asked];
      scheduler.start();
      scheduler.onEntry(asked);
      tick();

      expect(notes()).toEqual([
        {
          from: 'overmind',
          to: 'builder',
          kind: 'post',
          thread: 'a26',
          body: `${AGENT} is out of budget until a live run ends; a26 is queued`,
          meta: { refused: 'budget', agent: AGENT, hold: true },
        },
      ]);
    });

    it('tells a hold and then a spent day on the same ask, once each (HIVE-412)', () => {
      refuse = 'budget';
      refuseHold = true;
      entries = [asked];
      scheduler.start();
      scheduler.onEntry(asked);
      tick();
      refuseHold = false;
      tick();
      tick();

      expect(notes().map((note) => note.body)).toEqual([
        `${AGENT} is out of budget until a live run ends; a26 is queued`,
        `${AGENT} is out of budget until midnight; a26 is queued`,
      ]);
    });

    it('dedupes from the log on reason and hold together (HIVE-412)', () => {
      refuse = 'budget';
      refuseHold = true;
      entries = [
        asked,
        entry({ id: 'n1', from: 'overmind', to: 'builder', kind: 'post', thread: 'a26', body: 'x', meta: { refused: 'budget', agent: AGENT, hold: true } }),
      ];
      scheduler.start();
      scheduler.onEntry(asked);
      expect(notes()).toEqual([]);

      refuseHold = false;
      tick();
      expect(notes().map((note) => note.meta)).toEqual([{ refused: 'budget', agent: AGENT }]);
    });
  });

  describe('a refused wake', () => {
    /** The tracker refuses without ever reaching `onRunClosed`. */
    const refusing = (): void => {
      scheduler = createScheduler({
        run: (name, trigger, extra) => {
          woke.push({ name, trigger, ...(extra === undefined ? {} : { extra }) });
          return { started: false, refused: 'working' };
        },
        state,
        isAgent: (id) => id === AGENT,
        wakesOnLedger: () => true,
        parallelFor: () => 1,
      // This spec drives `onEntry` only; the tick has nothing to read.
      schedules: () => new Map(),
      pushStatus: () => {},
        ledger: { read: () => ({ entries }), append: () => ({ ok: true }) },
        now: () => clock,
      });
    };

    it('queues the entry instead of dropping it', () => {
      refusing();
      scheduler.onEntry(entry());

      expect(woke).toHaveLength(1);
      expect(state.read(AGENT).pendingWake).toEqual([
        { kind: 'ask', id: 'a1', from: 'overmind' },
      ]);
    });

    it('puts a flushed queue back', () => {
      /*
        The boot case is not a race: `mcp.start()` is still in flight when
        `start()` runs, so `wake-command` refuses for a config not yet written.
        Clearing without checking would destroy every crash-surviving queue at
        the one moment it is guaranteed to happen.
      */
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
      });
      refusing();

      scheduler.onRunClosed(AGENT);

      expect(woke).toHaveLength(1);
      expect(state.read(AGENT).pendingWake).toEqual([
        { kind: 'ask', id: 'a9', from: 'overmind' },
      ]);
    });

    it('keeps anything that arrived while the wake was being refused', () => {
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
      });
      scheduler = createScheduler({
        run: (name) => {
          // Something lands mid-refusal, as an append racing a flush would.
          state.patch(name, {
            pendingWake: [
              ...(state.read(name).pendingWake ?? []),
              { kind: 'post', id: 'a10', from: 'sess-2' },
            ],
          });
          return { started: false, refused: 'working' };
        },
        state,
        isAgent: (id) => id === AGENT,
        wakesOnLedger: () => true,
        parallelFor: () => 1,
      // This spec drives `onEntry` only; the tick has nothing to read.
      schedules: () => new Map(),
      pushStatus: () => {},
        ledger: { read: () => ({ entries }), append: () => ({ ok: true }) },
        now: () => clock,
      });

      scheduler.onRunClosed(AGENT);

      expect(state.read(AGENT).pendingWake).toEqual([
        { kind: 'ask', id: 'a9', from: 'overmind' },
        { kind: 'post', id: 'a10', from: 'sess-2' },
      ]);
    });
  });

  it('honours stop() on every entry point, not just the timer', () => {
    /*
      Teardown calls `closeAll`, which finalizes synchronously and so re-enters
      `onRunClosed`. A flush there spawns a process after `closeAll` has finished
      iterating — an orphan with nobody left to signal it.
    */
    state.patch(AGENT, {
      status: 'sleeping',
      pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
    });

    scheduler.start();
    woke.length = 0;
    scheduler.stop();

    scheduler.onRunClosed(AGENT);
    scheduler.onEntry(entry());

    expect(woke).toEqual([]);
  });

  describe('the moot sweep (HIVE-409)', () => {
    const job: LedgerEntry = { id: 'j1', ts: 0, from: 'sess-1', to: AGENT, kind: 'ask', body: 'build' };
    const started: LedgerEntry = { id: 'e1', ts: 0, from: AGENT, kind: 'event', body: 'run.started', meta: { run: 'r1', lane: 'thread:j1' } };
    const card: LedgerEntry = {
      id: 'c1', ts: 1, from: AGENT, to: 'overmind', kind: 'ask', ref: 'a9', body: 'Allow Bash?',
      meta: { kind: 'permission', tool: 'Bash', input: { command: 'git push' }, run: 'r1' },
    };
    const jobDone: LedgerEntry = { id: 'd1', ts: 2, from: AGENT, to: 'sess-1', kind: 'done', thread: 'j1', body: 'done' };
    const answers = (): LedgerPostRequest[] => appended.filter((e) => e.kind === 'answer');

    it('answers a card moot once its job thread has closed', () => {
      entries = [job, started, card, jobDone];
      clock = 60_000;
      scheduler.start();
      tick();
      expect(answers()).toEqual([
        { from: 'overmind', kind: 'answer', thread: 'c1', body: 'moot', meta: { moot: 'its job j1 closed' } },
      ]);
    });

    it('leaves a card alone while its job is open', () => {
      entries = [job, started, card];
      clock = 60_000;
      scheduler.start();
      tick();
      expect(answers()).toEqual([]);
    });

    it('never answers a non-permission ask moot', () => {
      entries = [job, started, { ...card, meta: { run: 'r1' } }, jobDone];
      clock = 60_000;
      scheduler.start();
      tick();
      expect(answers()).toEqual([]);
    });

    const mergeCard: LedgerEntry = {
      id: 'm1', ts: 1, from: AGENT, to: 'overmind', kind: 'ask', body: 'Allow Bash?',
      meta: { kind: 'permission', tool: 'Bash', input: { command: 'gh pr merge 252 --squash --repo behiques/hivetty' } },
    };
    const settle = async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    };

    it('answers a merge card moot on the tick after its PR is seen merged', async () => {
      entries = [mergeCard];
      prMergedFn.mockResolvedValue(true);
      clock = 60_000;
      scheduler.start();
      tick();
      await settle();
      expect(answers()).toEqual([]);
      tick();
      expect(prMergedFn).toHaveBeenCalledWith('behiques/hivetty', 252);
      expect(answers()).toEqual([
        { from: 'overmind', kind: 'answer', thread: 'm1', body: 'moot', meta: { moot: 'behiques/hivetty#252 merged' } },
      ]);
    });

    it('an open or unknown PR, or a failed lookup, closes nothing', async () => {
      for (const reply of [false, undefined, 'throw'] as const) {
        appended = [];
        entries = [mergeCard];
        if (reply === 'throw') prMergedFn.mockRejectedValue(new Error('gh missing'));
        else prMergedFn.mockResolvedValue(reply);
        scheduler = build();
        scheduler.start();
        tick();
        await settle();
        tick();
        expect(answers()).toEqual([]);
        scheduler.stop();
      }
    });

    it('looks a card up at most once every five minutes', async () => {
      entries = [mergeCard];
      prMergedFn.mockResolvedValue(false);
      clock = 0;
      scheduler.start();
      for (let i = 0; i < 5; i += 1) {
        clock += 60_000;
        tick();
        await settle();
      }
      expect(prMergedFn).toHaveBeenCalledTimes(1);
      clock += 60_000;
      tick();
      expect(prMergedFn).toHaveBeenCalledTimes(2);
    });

    it('never looks up a card that is not a merge', () => {
      entries = [job, started, card];
      clock = 60_000;
      scheduler.start();
      tick();
      expect(prMergedFn).not.toHaveBeenCalled();
    });
  });

  describe('the expiry sweep', () => {
    const askedByAgent: LedgerEntry = {
      id: 'a1',
      ts: 0,
      from: AGENT,
      to: 'overmind',
      kind: 'ask',
      ref: 'a7',
      body: 'which branch should the demo use?',
    };

    beforeEach(() => {
      entries = [askedByAgent];
      clock = LEDGER_ASK_TTL_MS;
    });

    it('retires an ask past its ttl, tells the log, and wakes the asker', () => {
      scheduler.start();
      tick();

      expect(appended).toEqual([
        {
          from: 'overmind',
          to: AGENT,
          kind: 'event',
          thread: 'a1',
          body: 'ask a7 expired',
          meta: { expired: 'a1' },
        },
      ]);
      // Spelled like every other wake — `<kind> <id> from <from>` — so a queued
      // expiry and an immediate one read the same to the model.
      expect(woke).toEqual([
        { name: AGENT, trigger: 'ledger', extra: 'expired a1 from overmind — your ask a7 expired unanswered' },
      ]);
    });

    it('does not sweep before the ttl', () => {
      clock = LEDGER_ASK_TTL_MS - 1;
      scheduler.start();
      tick();

      expect(appended).toEqual([]);
      expect(woke).toEqual([]);
    });

    it('sweeps again without re-retiring what it already told', () => {
      // The log itself is the sweep's memory: `expiredAsks` skips an ask whose
      // expiry event is already written, so a second pass finds nothing.
      scheduler.start();
      tick();

      entries = [
        askedByAgent,
        {
          id: 'e1',
          ts: clock,
          from: 'overmind',
          to: AGENT,
          kind: 'event',
          thread: 'a1',
          body: 'ask a7 expired',
          meta: { expired: 'a1' },
        },
      ];
      tick();

      expect(appended).toHaveLength(1);
      expect(woke).toHaveLength(1);
    });

    it('retires a session ask without waking anyone', () => {
      // The card is dismissed by the notifier either way; only an agent has a
      // run to start.
      entries = [{ ...askedByAgent, from: 'sess-4' }];
      scheduler.start();
      tick();

      expect(appended).toHaveLength(1);
      expect(woke).toEqual([]);
    });

    it('honours an ask that shortened its own ttl', () => {
      entries = [{ ...askedByAgent, meta: { ttlMs: 1_000 } }];
      clock = 1_000;
      scheduler.start();
      tick();

      expect(appended).toHaveLength(1);
    });

    it('falls back to the id when the ask has no ref', () => {
      entries = [{ ...askedByAgent, ref: undefined }];
      scheduler.start();
      tick();

      expect(appended[0]?.body).toBe('ask a1 expired');
      // The wake's sentence names the id for the same reason, and carries no ref.
      expect(woke).toEqual([
        { name: AGENT, trigger: 'ledger', extra: 'expired a1 from overmind — your ask a1 expired unanswered' },
      ]);
    });

    it('queues the expiry when the asker is mid-run', () => {
      /*
        The expiry event is on disk once written, so the sweep will never look
        at this ask again — a wake refused here would lose the news for good.
      */
      state.patch(AGENT, { status: 'working' });
      scheduler.start();
      tick();

      expect(appended).toHaveLength(1);
      expect(woke).toEqual([]);
      expect(state.read(AGENT).pendingWake).toEqual([
        { kind: 'expired', id: 'a1', from: 'overmind', ref: 'a7' },
      ]);

      state.patch(AGENT, { status: 'sleeping' });
      scheduler.onRunClosed(AGENT);

      expect(woke).toEqual([
        { name: AGENT, trigger: 'ledger', extra: 'expired a1 from overmind — your ask a7 expired unanswered' },
      ]);
    });

    it('does not wake when the expiry could not be written', () => {
      /*
        The write is the dedup. Waking without it would re-expire the same ask
        every sixty seconds for as long as the disk stays unwritable.
      */
      appendOk = false;
      scheduler = build();
      scheduler.start();
      tick();
      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).pendingWake ?? []).toEqual([]);
    });

    it('leaves an asker that does not take ledger wakes unwoken', () => {
      wakesOnLedger = false;
      scheduler = build();
      scheduler.start();
      tick();

      expect(appended).toHaveLength(1);
      expect(woke).toEqual([]);
    });

    it('stops sweeping after stop()', () => {
      scheduler.start();
      scheduler.stop();
      tick();

      expect(appended).toEqual([]);
    });

    it('arms nothing until start()', () => {
      tick();

      expect(appended).toEqual([]);
    });
  });

  /*
    Time passed (HIVE-121).

    Every case below drives the *same* interval the expiry sweep runs on —
    there is one timer in this module and it does two jobs — and asserts
    against `agents.json` rather than against a timer handle, because
    `nextRunAt` on disk is the only representation of when a wake is due.
  */
  describe('the interval tick', () => {
    const NOON = new Date(2026, 7, 31, 12).getTime();
    const every5m: WakeSpec = { everyMs: 300_000, check: 'always', on: [] };

    beforeEach(() => {
      clock = NOON;
      /*
        Armed before each case arranges anything, so the immediate tick inside
        `start()` finds no schedules and does nothing — leaving `tick()` below
        as the one tick under test. The two cases that are *about* `start()`
        live in their own describe, without this.
      */
      scheduler.start();
    });

    it('starts a wake queued under a spent day on the first tick of the next (HIVE-408)', () => {
      const DAY = 24 * 60 * 60 * 1000;
      state.patch(AGENT, {
        today: { day: dayKey(clock), runs: 3, usd: 40, capped: true },
        pendingWake: [{ kind: 'ask', id: 'a26', from: 'builder' }],
      });
      tick();
      expect(woke).toEqual([]);

      clock = NOON + DAY;
      tick();
      expect(woke).toEqual([expect.objectContaining({ name: AGENT, trigger: 'ledger' })]);
      expect(state.read(AGENT).pendingWake ?? []).toEqual([]);
    });

    /*
      Arm, do not fire. A definition saved in Settings is a schedule starting
      now, not a wake owed since the epoch — and `nextRunAt` is absent for
      exactly as long as an agent has never been scheduled.
    */
    it('seeds a next run rather than firing the instant an agent is created', () => {
      schedules.set(AGENT, { wake: every5m });

      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).nextRunAt).toBe(NOON + 300_000);
    });

    /*
      The feature's primary path, and the one every other case here hid.

      `agents.json` gains an entry when an agent *runs*, is paused, or is
      queued against — nothing writes one when a definition is merely saved.
      So an agent authored in Settings and left alone has a schedule and no run
      state, and a tick driven off `state.all()` never sees it: it would never
      wake, on a fresh install or on any newly created agent, and the only
      escape would be clicking Run now once.

      Every other scheduling case in this file calls `state.patch` first, which
      is exactly why they could not catch it.
    */
    it('schedules an agent that has never run and has no state entry', () => {
      schedules.set('brand-new', { wake: every5m });

      tick();

      expect(state.read('brand-new').nextRunAt).toBe(NOON + 300_000);
    });

    it('wakes an agent whose only trace is its definition', () => {
      schedules.set('brand-new', { wake: every5m });

      tick();
      clock = NOON + 300_000;
      tick();

      expect(woke).toEqual([{ name: 'brand-new', trigger: 'interval' }]);
    });

    /*
      A schedule that got shorter must not wait out the old, longer time.

      `every: 6h` armed at 10:00 and edited to `every: 5m` at 10:05 would
      otherwise sit until 16:00 — and a calendar agent switched to an interval
      would sit for nearly a day. The docs promise a definition change re-arms
      the schedule; without this they are only true in the lengthening
      direction.
    */
    it('re-arms when the interval is shortened under it', () => {
      state.patch(AGENT, { nextRunAt: NOON + 6 * 60 * 60_000 });
      schedules.set(AGENT, { wake: every5m });

      tick();

      expect(state.read(AGENT).nextRunAt).toBe(NOON + 300_000);
    });

    /*
      The clamp bounds the remaining wait at one interval of the *new*
      schedule — it does not fire immediately.

      That is deliberate. Firing at once would mean re-deriving the owed time
      from `lastRunAt`, and the moment the tick arms a wake it has not yet
      recorded, `lastRunAt` still names the *previous* run — so the next tick
      would read the same stale time and wake again. Bounding the wait instead
      is one comparison, cannot double-fire, and costs at most one interval.
    */
    it('wakes within one interval of the shortened schedule, not at once', () => {
      state.patch(AGENT, { nextRunAt: NOON + 6 * 60 * 60_000, lastRunAt: NOON - 600_000 });
      schedules.set(AGENT, { wake: { everyMs: 60_000, check: 'always', on: [] } });

      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).nextRunAt).toBe(NOON + 60_000);

      clock = NOON + 60_000;
      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('leaves a longer schedule to run its course rather than pushing it out', () => {
      state.patch(AGENT, { nextRunAt: NOON + 60_000 });
      schedules.set(AGENT, { wake: { everyMs: 6 * 60 * 60_000, check: 'always', on: [] } });

      tick();

      expect(state.read(AGENT).nextRunAt).toBe(NOON + 60_000);
    });

    it('wakes on the boundary and arms the next one', () => {
      state.patch(AGENT, { nextRunAt: NOON });
      schedules.set(AGENT, { wake: every5m });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
      expect(state.read(AGENT).nextRunAt).toBe(NOON + 300_000);
    });

    it('does not wake before the time it armed', () => {
      state.patch(AGENT, { nextRunAt: NOON + 60_000 });
      schedules.set(AGENT, { wake: every5m });

      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).nextRunAt).toBe(NOON + 60_000);
    });

    /*
      One wake for a missed window, not one per missed interval.

      This is the whole reason `nextRunAt` is polled off disk rather than held
      in a `setTimeout`: six hours of lid-shut sleep is one overdue timestamp,
      and one overdue timestamp is one wake. A per-agent timer would have to
      reconstruct that, and a naive catch-up loop would spawn 72 runs.
    */
    it('wakes once for a long-overdue time, not once per missed interval', () => {
      state.patch(AGENT, { nextRunAt: NOON - 6 * 60 * 60_000 });
      schedules.set(AGENT, { wake: every5m });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
      expect(state.read(AGENT).nextRunAt).toBe(NOON + 300_000);
    });

    it.each(['working', 'paused', 'asking'] as const)(
      'takes no scheduled wake while %s',
      (status) => {
        // Asking on an open ask: one with none left is stale, and resumes.
        entries.push(entry({ from: AGENT, to: 'overmind', ts: NOON - 1_000 }));
        state.patch(AGENT, { status, nextRunAt: NOON });
        schedules.set(AGENT, { wake: every5m });

        tick();

        expect(woke).toEqual([]);
      },
    );

    /*
      An `asking` agent keeps its overdue `nextRunAt` deliberately. When the
      answer lands and the status moves, the next tick finds one stale time and
      spends it as a single catch-up wake — the same path the boot case takes.
    */
    it('leaves an asking agent its stale next run, to spend when it resumes', () => {
      entries.push(entry({ from: AGENT, to: 'overmind', ts: NOON - 1_000 }));
      state.patch(AGENT, { status: 'asking', nextRunAt: NOON - 60_000 });
      schedules.set(AGENT, { wake: every5m });

      tick();

      expect(state.read(AGENT).nextRunAt).toBe(NOON - 60_000);
    });

    it('wakes a failed agent — a failed run is not a paused one', () => {
      state.patch(AGENT, { status: 'failed', nextRunAt: NOON });
      schedules.set(AGENT, { wake: every5m });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('clears a stale next run when the definition stops scheduling', () => {
      state.patch(AGENT, { nextRunAt: NOON + 60_000 });
      schedules.set(AGENT, { wake: { on: ['ledger'] } });

      tick();

      expect(state.read(AGENT).nextRunAt).toBeUndefined();
    });

    /*
      A definition that will not parse is absent from the schedule map, and
      that is what stops a broken file being woken on a timer — the same agent
      is still *listed*, so the user can see and fix it.
    */
    it('leaves an agent with no usable definition alone', () => {
      state.patch(AGENT, { nextRunAt: NOON });

      tick();

      expect(woke).toEqual([]);
    });

    /*
      "The registry has not answered yet" is not "this agent has no schedule",
      and conflating them destroys the thing the boot tick exists to catch.

      `refreshKnownAgents` fills the schedule map from an unawaited
      `agents.list()` — a folder walk that reads and parses every `AGENT.md` —
      while `scheduler.start()` ticks synchronously. The walk routinely loses
      that race. If an empty map read as "nothing is scheduled", the first tick
      after every launch would clear the overdue `nextRunAt` of every agent, and
      the promise that a missed window wakes once would be false precisely when
      it matters: on the launch that follows the miss.
    */
    it('waits for the registry rather than clearing what it cannot see', () => {
      listed = false;
      state.patch(AGENT, { nextRunAt: NOON - 60_000 });

      tick();

      expect(state.read(AGENT).nextRunAt).toBe(NOON - 60_000);
      expect(woke).toEqual([]);
    });

    it('spends that overdue time as one wake once the registry answers', () => {
      listed = false;
      state.patch(AGENT, { nextRunAt: NOON - 60_000, lastRunAt: NOON - 600_000 });
      schedules.set(AGENT, { wake: every5m });

      tick();
      listed = true;
      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      And once it has answered, an agent genuinely missing from it *is* one
      with no usable schedule — a definition that stopped parsing mid-edit —
      so a stale time is cleared rather than left promising a wake.
    */
    it('clears a stale next run once the registry has answered without it', () => {
      state.patch(AGENT, { nextRunAt: NOON + 60_000 });

      tick();

      expect(state.read(AGENT).nextRunAt).toBeUndefined();
    });

    /*
      A skip changes a row and starts no run, so nothing else would tell the
      renderer. Without this push `next 18:20 · skipped 3` goes stale on
      precisely the agent somebody is staring at the row to diagnose: one that
      is deliberately not running.
    */
    it('pushes the row when a skip changes it', () => {
      state.patch(AGENT, { nextRunAt: NOON, lastRunAt: NOON - 600_000 });
      schedules.set(AGENT, {
        wake: { everyMs: 300_000, check: 'onchange', on: [] },
      });

      tick();

      expect(state.read(AGENT).skipsSinceRun).toBe(1);
      expect(pushed).toEqual([AGENT]);
    });

    it('pushes nothing on a tick that changes nothing', () => {
      state.patch(AGENT, { nextRunAt: NOON + 60_000 });
      schedules.set(AGENT, { wake: every5m });

      tick();

      expect(pushed).toEqual([]);
    });

    it('names the calendar trigger for a fixed-time agent', () => {
      state.patch(AGENT, { nextRunAt: NOON });
      schedules.set(AGENT, { wake: { at: ['09:00'], on: [] } });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'schedule' }]);
      expect(state.read(AGENT).nextRunAt).toBe(new Date(2026, 8, 1, 9).getTime());
    });

  });

  describe('the tick and the app lifecycle', () => {
    const NOON = new Date(2026, 7, 31, 12).getTime();
    const every5m: WakeSpec = { everyMs: 300_000, check: 'always', on: [] };

    beforeEach(() => {
      clock = NOON;
    });

    /*
      Without this a restart waits a full period before noticing an agent whose
      time passed while the app was closed — which for a `daily` agent is a
      whole extra day of silence.
    */
    it('ticks once immediately on start, so a restart does not wait a minute', () => {
      state.patch(AGENT, { nextRunAt: NOON - 1 });
      schedules.set(AGENT, { wake: every5m });

      scheduler.start();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      `stop()` sets a flag every entry point honours rather than only clearing
      the interval, because shutdown finalizes live runs synchronously and
      re-enters this module from inside its own teardown.
    */
    it('stops ticking once stopped', () => {
      scheduler.start();
      state.patch(AGENT, { nextRunAt: NOON });
      schedules.set(AGENT, { wake: every5m });
      scheduler.stop();

      tick();

      expect(woke).toEqual([]);
    });
  });

  describe('quiet hours', () => {
    const quiet = { from: '23:00', to: '07:00' };
    const LATE = new Date(2026, 7, 31, 23, 30).getTime();
    const MORNING = new Date(2026, 8, 1, 7).getTime();

    // Armed before anything is arranged — see the interval tick's beforeEach.
    beforeEach(() => {
      scheduler.start();
    });

    it('defers to the end of the window instead of waking inside it', () => {
      clock = LATE;
      state.patch(AGENT, { nextRunAt: LATE });
      schedules.set(AGENT, {
        wake: { everyMs: 300_000, check: 'always', quiet, on: [] },
      });

      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).nextRunAt).toBe(MORNING);
    });

    /*
      A silence the author asked for is not the same fact as "nothing changed",
      so it must not move the number that reports the second one. Otherwise a
      nightly agent reads `skipped 96` every morning for working perfectly.
    */
    it('does not count a quiet-hours deferral as a skip', () => {
      clock = LATE;
      state.patch(AGENT, { nextRunAt: LATE, skipsSinceRun: 0 });
      schedules.set(AGENT, {
        wake: { everyMs: 300_000, check: 'onchange', quiet, on: [] },
      });

      tick();

      expect(state.read(AGENT).skipsSinceRun).toBe(0);
    });

    it('wakes normally outside the window', () => {
      clock = new Date(2026, 7, 31, 12).getTime();
      state.patch(AGENT, { nextRunAt: clock });
      schedules.set(AGENT, {
        wake: { everyMs: 300_000, check: 'always', quiet, on: [] },
      });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      A ledger-addressed wake is not a scheduled one and quiet hours do not
      touch it — the field's own help sentence promises exactly that: "no
      scheduled wakes inside the window; a message addressed to the agent still
      wakes it".
    */
    it('does not suppress a ledger-addressed wake', () => {
      clock = LATE;
      schedules.set(AGENT, {
        wake: { everyMs: 300_000, check: 'always', quiet, on: ['ledger'] },
      });

      scheduler.onEntry(entry({ ts: LATE }));

      expect(woke).toHaveLength(1);
    });
  });

  describe('check: onchange', () => {
    const NOON = new Date(2026, 7, 31, 12).getTime();
    const onchange: WakeSpec = { everyMs: 300_000, check: 'onchange', on: [] };

    beforeEach(() => {
      clock = NOON;
      // Armed before anything is arranged — see the interval tick's beforeEach.
      scheduler.start();
      state.patch(AGENT, { nextRunAt: NOON, lastRunAt: NOON - 600_000 });
      schedules.set(AGENT, { wake: onchange });
    });

    it('skips a tick with nothing addressed since the last run, and counts it', () => {
      state.patch(AGENT, { skipsSinceRun: 2 });

      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).skipsSinceRun).toBe(3);
      expect(state.read(AGENT).nextRunAt).toBe(NOON + 300_000);
    });

    it('wakes when an entry addressed to it arrived since the last run', () => {
      entries.push(entry({ kind: 'post', ts: NOON - 60_000 }));

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('ignores an entry older than the last run', () => {
      entries.push(entry({ kind: 'post', ts: NOON - 900_000 }));

      tick();

      expect(woke).toEqual([]);
    });

    it('ignores an entry addressed to somebody else', () => {
      entries.push(entry({ kind: 'post', to: 'zergling', ts: NOON - 60_000 }));

      tick();

      expect(woke).toEqual([]);
    });

    it('ignores a broadcast, which is addressed to nobody', () => {
      entries.push(entry({ kind: 'post', to: undefined, ts: NOON - 60_000 }));

      tick();

      expect(woke).toEqual([]);
    });

    it('wakes when a queued entry is waiting, whatever its age', () => {
      state.patch(AGENT, {
        pendingWake: [{ id: 'a1', kind: 'ask', from: 'overmind' }],
      });
      // The sweep's retry is refused, so the queue is still standing at the tick.
      refuseAfter = runCalls;

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      `wake.on: [ledger]` gates whether an entry *wakes* the agent. It does not
      gate whether that entry is a change worth waking for on a schedule the
      author did set — the field's help promises a question "waits unread until
      the next scheduled wake", and this is that wake arriving to read it.
    */
    it('counts an addressed entry even for an agent that does not wake on the ledger', () => {
      wakesOnLedger = false;
      entries.push(entry({ ts: NOON - 60_000 }));

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('treats an agent that has never run as having something to do', () => {
      state.patch(AGENT, { lastRunAt: undefined });
      entries.push(entry({ ts: NOON - 60_000 }));

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('never skips under check: always', () => {
      schedules.set(AGENT, { wake: { everyMs: 300_000, check: 'always', on: [] } });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });
  });

  describe('slack signed out (HIVE-123)', () => {
    const NOON = new Date(2026, 7, 31, 12).getTime();
    const every5m: WakeSpec = { everyMs: 300_000, check: 'always', on: [] };

    beforeEach(() => {
      clock = NOON;
      // Armed before anything is arranged — see the interval tick's beforeEach.
      scheduler.start();
      // The default for this block is an agent that currently names slack;
      // the stale-definition case below overrides it to `[]`.
      schedules.set(AGENT, { wake: every5m, mcp: ['slack'] });
    });

    it('skips a scheduled wake whose last run found slack signed out', () => {
      state.patch(AGENT, {
        nextRunAt: NOON,
        lastRunAt: NOON - 600_000,
        runs: [
          {
            run: 'r1',
            trigger: 'interval',
            startedAt: NOON - 600_000,
            endedAt: NOON - 599_000,
            outcome: 'done',
            slack: 'needs-auth',
          },
        ],
      });

      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).skipsSinceRun).toBe(1);
    });

    /**
     * The livelock, and the only thing that breaks it (HIVE-123 self-review).
     *
     * The skip gates on what the agent's **last run** found — and only a run
     * can rewrite that field, which the skip is precisely what prevents. For
     * the shipped `slack-watcher` (`every: 5m`, rare ledger traffic) that is
     * not a delay but a permanent stall, while the pane's caption promises
     * signing in fixes it.
     *
     * `clearSlackNeedsAuth` is what the `slack:sign-in` handler calls on a
     * successful sign-in, and this drives the whole cycle rather than the call
     * alone: a run that found Slack signed out, a tick that skips, the
     * sign-in, and then a tick that actually wakes.
     */
    it('wakes on the next tick once a sign-in has cleared the stale marker', () => {
      state.patch(AGENT, {
        nextRunAt: NOON,
        lastRunAt: NOON - 600_000,
        runs: [
          {
            run: 'r1',
            trigger: 'interval',
            startedAt: NOON - 600_000,
            endedAt: NOON - 599_000,
            outcome: 'done',
            slack: 'needs-auth',
          },
        ],
      });

      tick();

      expect(woke).toEqual([]);

      expect(state.clearSlackNeedsAuth()).toEqual([AGENT]);

      // The skipped tick re-armed for five minutes out; that is when the wake
      // it was owed comes back round.
      clock = NOON + 300_000;
      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('does not skip once the last run found slack connected', () => {
      state.patch(AGENT, {
        nextRunAt: NOON,
        lastRunAt: NOON - 600_000,
        runs: [
          {
            run: 'r1',
            trigger: 'interval',
            startedAt: NOON - 600_000,
            endedAt: NOON - 599_000,
            outcome: 'done',
            slack: 'connected',
          },
        ],
      });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      An agent that has never run has no `runs[]` entry at all — and it must
      not be skipped on that account. It has to be allowed to discover its own
      status once, or a signed-out-at-boot Slack would wedge it permanently.
    */
    it('does not skip an agent that has never run', () => {
      state.patch(AGENT, { nextRunAt: NOON });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      A run that never named slack at all — no `mcp: [slack]`, or a spawn
      failure before any `init` event arrived — leaves `slack` unset, and
      unset is not "signed out".
    */
    it('does not skip a run that never named slack', () => {
      state.patch(AGENT, {
        nextRunAt: NOON,
        lastRunAt: NOON - 600_000,
        runs: [
          {
            run: 'r1',
            trigger: 'interval',
            startedAt: NOON - 600_000,
            endedAt: NOON - 599_000,
            outcome: 'done',
          },
        ],
      });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      The re-review's finding: `state.ts`'s `saveAgent`/`renameAgent`/
      `deleteAgent` never clear or invalidate `AgentRunState.runs` when a
      definition is saved. An agent that removed `slack` from `mcp:` after a
      `needs-auth` run must not keep skipping on a fact that stopped being
      true — the gate is the schedule's *current* `mcp`, read off the same
      map `wake` already comes from, not an inference from run history alone.
    */
    it('does not skip once the definition no longer names slack, even with a stale needs-auth run', () => {
      schedules.set(AGENT, { wake: every5m, mcp: [] });
      state.patch(AGENT, {
        nextRunAt: NOON,
        lastRunAt: NOON - 600_000,
        runs: [
          {
            run: 'r1',
            trigger: 'interval',
            startedAt: NOON - 600_000,
            endedAt: NOON - 599_000,
            outcome: 'done',
            slack: 'needs-auth',
          },
        ],
      });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    // A schedule from before HIVE-123 (no `mcp` at all) must not crash or
    // silently start skipping — absent reads as `[]`, same as an empty list.
    it('does not skip when the schedule carries no mcp field at all', () => {
      schedules.set(AGENT, { wake: every5m });
      state.patch(AGENT, {
        nextRunAt: NOON,
        lastRunAt: NOON - 600_000,
        runs: [
          {
            run: 'r1',
            trigger: 'interval',
            startedAt: NOON - 600_000,
            endedAt: NOON - 599_000,
            outcome: 'done',
            slack: 'needs-auth',
          },
        ],
      });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });
  });

  describe('the daily token cap (HIVE-398)', () => {
    const NOON = new Date(2026, 7, 31, 12).getTime();
    const MIDNIGHT = new Date(2026, 8, 1).getTime();
    const tokenCapped = {
      wake: { everyMs: 300_000, check: 'always' as const, on: [] },
      dailyTokens: 1_000,
    };
    const cards = () =>
      appended.filter((item) => (item.meta as { dailyCap?: number } | undefined)?.dailyCap !== undefined);

    beforeEach(() => {
      clock = NOON;
      scheduler.start();
      state.patch(AGENT, { nextRunAt: NOON });
      schedules.set(AGENT, tokenCapped);
    });

    it("stops scheduled wakes once today's tokens reach the cap, carding once", () => {
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 2, usd: 0, tokens: 1_000 } });

      tick();
      state.patch(AGENT, { nextRunAt: NOON });
      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).today?.capped).toBe(true);
      expect(cards()).toEqual([
        expect.objectContaining({
          from: 'overmind',
          kind: 'event',
          body: `${AGENT} reached its daily token cap — 1,000 tokens`,
          meta: { dailyCap: 1_000, unit: 'tokens', agent: AGENT },
        }),
      ]);
    });

    it('arms the next wake for local midnight on a token cap', () => {
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 2, usd: 0, tokens: 1_000 } });

      tick();

      expect(state.read(AGENT).nextRunAt).toBe(MIDNIGHT);
    });

    it('wakes under the token cap', () => {
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 2, usd: 0, tokens: 999 } });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('names the dollar cap when both are spent, USD checked first', () => {
      schedules.set(AGENT, { ...tokenCapped, dailyUsd: 0.1 });
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 2, usd: 0.14, tokens: 1_000 } });

      tick();

      expect(cards()).toEqual([
        expect.objectContaining({ meta: { dailyCap: 0.1, agent: AGENT } }),
      ]);
    });
  });

  describe('the daily cap', () => {
    const NOON = new Date(2026, 7, 31, 12).getTime();
    const MIDNIGHT = new Date(2026, 8, 1).getTime();
    const capped = {
      wake: { everyMs: 300_000, check: 'always' as const, on: [] },
      dailyUsd: 0.1,
    };

    beforeEach(() => {
      clock = NOON;
      // Armed before anything is arranged — see the interval tick's beforeEach.
      scheduler.start();
      state.patch(AGENT, { nextRunAt: NOON });
      schedules.set(AGENT, capped);
    });

    it("stops scheduled wakes once today's spend reaches the cap", () => {
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 2, usd: 0.14 } });

      tick();

      expect(woke).toEqual([]);
    });

    /*
      Midnight rather than the next interval, so the agent is not re-deciding
      to stay capped every five minutes for the rest of the day — and so `Next`
      names the hour it will actually come back.
    */
    it('arms the next wake for local midnight', () => {
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 2, usd: 0.14 } });

      tick();

      expect(state.read(AGENT).nextRunAt).toBe(MIDNIGHT);
    });

    it('posts the card once, not on every tick for the rest of the day', () => {
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 2, usd: 0.14 } });

      tick();
      state.patch(AGENT, { nextRunAt: NOON });
      tick();

      const posted = appended.filter(
        (item) => (item.meta as { dailyCap?: number } | undefined)?.dailyCap !== undefined,
      );

      expect(posted).toHaveLength(1);
      /*
        From the **overmind**, not the agent. `meta` is a free-form rider any
        party can write, so a card keyed off an agent's own `from` is one any
        agent could mint for itself — the same reason the expiry event is the
        overmind's. Main declined to start this run; main says so.
      */
      expect(posted[0]).toMatchObject({
        from: 'overmind',
        kind: 'event',
        meta: { dailyCap: 0.1, agent: AGENT },
      });
      expect(state.read(AGENT).today?.capped).toBe(true);
    });

    it('runs normally while spend is under the cap', () => {
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 1, usd: 0.07 } });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('ignores a cap for an agent whose definition names none', () => {
      schedules.set(AGENT, { wake: capped.wake });
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 99, usd: 99 } });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      Yesterday's total cannot cap today. `recordRun` replaces the accumulator
      wholesale on a new day, but a tick can land before the day's first run —
      so the comparison has to check the day key, not only the number.
    */
    it('ignores a total belonging to a previous day', () => {
      state.patch(AGENT, { today: { day: '2026-08-30', runs: 9, usd: 9 } });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    /*
      A budget for unattended work, not a lock on the agent. The gate lives in
      the tick rather than in `RunTracker.run`, so a ledger entry and a manual
      run both still reach the agent while it is capped.
    */
    it('does not stop a ledger-addressed wake', () => {
      state.patch(AGENT, { today: { day: '2026-08-31', runs: 2, usd: 0.14 } });
      tick();

      scheduler.onEntry(entry({ ts: NOON }));

      expect(woke).toEqual([
        { name: AGENT, trigger: 'ledger', extra: 'ask a1 from overmind' },
      ]);
    });
  });

  describe('a scheduled wake the tracker refuses', () => {
    /*
      HIVE-119 defers a permission answer's wake behind the grant write, so
      between the answer landing and the grant completing there is a window
      with the entry on the log and no run started. A tick inside that window
      must not become a second wake for the same entry — and it cannot, because
      both go through `RunTracker.run`, which refuses a `working` agent.

      What this pins is the other half: a refusal is a wake deferred, not a
      quiet tick, so it arms the next time and leaves the skip count alone.
    */
    it('arms the next time without counting a skip', () => {
      const NOON = new Date(2026, 7, 31, 12).getTime();

      clock = NOON;
      scheduler.start();
      state.patch(AGENT, {
        nextRunAt: NOON,
        lastRunAt: NOON - 600_000,
        skipsSinceRun: 1,
      });
      schedules.set(AGENT, { wake: { everyMs: 300_000, check: 'always', on: [] } });
      refuse = 'working';

      tick();

      expect(state.read(AGENT).skipsSinceRun).toBe(1);
      expect(state.read(AGENT).nextRunAt).toBe(NOON + 300_000);
    });
  });

  /*
    A refused wake used to wait for a run close, a resume or a boot. An
    `asking` agent gets none of those, and the tick skipped it too, so a
    single refusal stranded its queue for good (the Slack agent, 10-17).
  */
  describe('a refused wake with no run close coming', () => {
    const asked: LedgerEntry = {
      id: 'a21',
      ts: 0,
      from: AGENT,
      to: 'overmind',
      kind: 'ask',
      ref: 'a21',
      body: 'send this reply?',
    };
    const expiry: LedgerEntry = {
      id: 'e1',
      ts: LEDGER_ASK_TTL_MS,
      from: 'overmind',
      to: AGENT,
      kind: 'event',
      thread: 'a21',
      body: 'ask a21 expired',
      meta: { expired: 'a21' },
    };

    it('returns an agent to sleeping when its only open ask was accepted (HIVE-410)', () => {
      clock = 1_000;
      entries = [
        { ...asked, to: 'shipper' },
        { id: 'p1', ts: 500, from: 'shipper', to: AGENT, kind: 'post', thread: 'a21', body: 'accepted', meta: { accepted: true } },
      ];
      state.patch(AGENT, { status: 'asking' });
      scheduler.start();
      tick();

      expect(state.read(AGENT).status).toBe('sleeping');
    });

    it('retries the queue on the next tick, so an asking agent hears its expiry', () => {
      entries = [asked];
      clock = LEDGER_ASK_TTL_MS;
      state.patch(AGENT, { status: 'asking' });
      refuse = 'invalid';
      scheduler.start();
      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).pendingWake).toEqual([
        { kind: 'expired', id: 'a21', from: 'overmind', ref: 'a21' },
      ]);

      entries = [asked, expiry];
      refuse = false;
      tick();

      expect(woke).toEqual([
        { name: AGENT, trigger: 'ledger', extra: 'expired a21 from overmind — your ask a21 expired unanswered' },
      ]);
      expect(state.read(AGENT).pendingWake).toEqual([]);
    });

    it('never retries a paused agent', () => {
      state.patch(AGENT, {
        status: 'paused',
        pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
      });
      scheduler.start();
      tick();

      expect(runCalls).toBe(0);
      expect(state.read(AGENT).pendingWake).toHaveLength(1);
    });

    it('returns an asking agent with no open ask to its schedule', () => {
      const NOON = new Date(2026, 9, 19, 12).getTime();

      clock = NOON;
      entries = [asked, expiry];
      state.patch(AGENT, { status: 'asking', nextRunAt: NOON - 60_000, lastRunAt: NOON - 600_000 });
      schedules.set(AGENT, { wake: { everyMs: 300_000, check: 'always', on: [] } });
      scheduler.start();
      tick();

      expect(state.read(AGENT).status).toBe('sleeping');
      expect(pushed).toContain(AGENT);
      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]);
    });

    it('leaves an agent asking while its ask is open', () => {
      clock = 1_000;
      entries = [asked];
      state.patch(AGENT, { status: 'asking' });
      scheduler.start();
      tick();

      expect(state.read(AGENT).status).toBe('asking');
    });

    it('warns a refusal reason once, not every tick', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      state.patch(AGENT, { pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }] });
      refuse = 'invalid';
      refuseReason = 'The MCP config has not been written yet.';
      scheduler.start();
      tick();
      tick();

      expect(runCalls).toBe(3);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('The MCP config has not been written yet.'));
      warn.mockRestore();
    });

    it('retries a wake queued behind its CLI each minute, warns once, and runs it when the CLI is back (HIVE-399)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      state.patch(AGENT, { pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }] });
      refuse = 'cli';
      refuseReason = 'codex is turned off for agents in Settings › Harnesses';
      refuseCli = 'codex';
      scheduler.start();
      tick();
      tick();

      expect(state.read(AGENT).pendingWake).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('codex is turned off'));

      refuse = false;
      tick();

      expect(state.read(AGENT).pendingWake ?? []).toHaveLength(0);
      expect(woke).toHaveLength(1);
      warn.mockRestore();
    });
  });

  describe('task runs (HIVE-128)', () => {
    it('marks a run with a prompt as a job, and a bare run as not', () => {
      scheduler.manualWake(AGENT, 'review PR 166');
      scheduler.manualWake(AGENT);

      expect(woke).toEqual([
        { name: AGENT, trigger: 'manual', extra: 'review PR 166', job: true },
        { name: AGENT, trigger: 'manual' },
      ]);
    });

    it('flushes each queued job as its own run when the agent fans out, after the standing wake', () => {
      parallel = 3;
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [
          { kind: 'manual', id: 'run', from: 'overmind', text: 'review PR 166' },
          { kind: 'ask', id: 'a1', from: 'overmind' },
          { kind: 'manual', id: 'run', from: 'overmind', text: 'review PR 167' },
        ],
      });

      scheduler.onRunClosed(AGENT);

      expect(woke).toEqual([
        { name: AGENT, trigger: 'ledger', extra: 'ask a1 from overmind' },
        { name: AGENT, trigger: 'manual', extra: 'review PR 166', job: true },
        { name: AGENT, trigger: 'manual', extra: 'review PR 167', job: true },
      ]);
      expect(state.read(AGENT).pendingWake).toEqual([]);
    });

    it('flushes one bundled wake at the default cap, exactly as before', () => {
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [
          { kind: 'manual', id: 'run', from: 'overmind', text: 'review PR 166' },
          { kind: 'ask', id: 'a1', from: 'overmind' },
        ],
      });

      scheduler.onRunClosed(AGENT);

      expect(woke).toHaveLength(1);
      expect(woke[0]?.extra).toContain('review PR 166');
      expect(woke[0]?.extra).toContain('ask a1 from overmind');
    });

    it('puts a job back, and the ones behind it, when the cap refuses', () => {
      parallel = 2;
      refuseAfter = 1; // the second call is refused saturated
      state.patch(AGENT, {
        status: 'sleeping',
        pendingWake: [
          { kind: 'manual', id: 'run', from: 'overmind', text: 'one' },
          { kind: 'manual', id: 'run', from: 'overmind', text: 'two' },
          { kind: 'manual', id: 'run', from: 'overmind', text: 'three' },
        ],
      });

      scheduler.onRunClosed(AGENT);

      expect(woke.map((wake) => wake.extra)).toEqual(['one']);
      expect((state.read(AGENT).pendingWake ?? []).map((entry) => entry.text)).toEqual([
        'two',
        'three',
      ]);
    });
  });

  describe('onEvent (HIVE-124)', () => {
    /*
      The bridge has already decided which agent and already coalesced the
      burst, so these tests only interrogate the one question left: can this
      agent take a wake right now.
    */

    it('wakes a sleeping agent with the slack trigger and the event line', () => {
      scheduler.onEvent(
        AGENT,
        { kind: 'slack.channel', id: '1757.1', from: 'U08', text: '#x (C1) · …' },
        { job: false },
      );

      expect(woke).toEqual([
        {
          name: AGENT,
          trigger: 'slack',
          extra: 'slack.channel 1757.1 from U08 — #x (C1) · …',
        },
      ]);
    });

    it('queues while working and flushes as one wake when the run closes', () => {
      state.patch(AGENT, { status: 'working' });

      scheduler.onEvent(
        AGENT,
        { kind: 'slack.channel', id: '1757.1', from: 'U08', text: 'first' },
        { job: false },
      );
      scheduler.onEvent(
        AGENT,
        { kind: 'slack.channel', id: '1757.2', from: 'U08', text: 'second' },
        { job: false },
      );

      expect(woke).toEqual([]);

      state.patch(AGENT, { status: 'sleeping' });
      scheduler.onRunClosed(AGENT);

      expect(woke).toHaveLength(1);
      expect(woke[0]?.trigger).toBe('slack');
      expect(woke[0]?.extra).toContain('1757.1');
      expect(woke[0]?.extra).toContain('1757.2');
    });

    it('holds for a paused agent and delivers on resume', () => {
      state.patch(AGENT, { status: 'paused' });

      scheduler.onEvent(
        AGENT,
        { kind: 'slack.channel', id: '1757.1', from: 'U08', text: 'first' },
        { job: false },
      );

      expect(woke).toEqual([]);

      state.patch(AGENT, { status: 'sleeping' });
      scheduler.onResume(AGENT);

      expect(woke).toHaveLength(1);
    });

    it('wakes at once for a job entry, reporting job:true and the slack trigger', () => {
      scheduler.onEvent(
        AGENT,
        { kind: 'slack.command', id: '1757.9', from: 'U08', text: 'review 42' },
        { job: true },
      );

      expect(woke).toEqual([
        { name: AGENT, trigger: 'slack', extra: 'review 42', job: true },
      ]);
    });

    /*
      A `slack.command` job run must report `slack`, not `manual` — `manual`
      names the route a person pressing Run inside the app takes, and this one
      arrived off a socket. Corrects the brief, which copied the shipped
      `flush` line before this task's own change to `triggerFor` existed.
    */
    it('runs a slack command as its own job on an agent that fans out', () => {
      parallel = 3;
      state.patch(AGENT, { status: 'working' });

      scheduler.onEvent(
        AGENT,
        { kind: 'slack.command', id: '1757.9', from: 'U08', text: 'review 42' },
        { job: true },
      );

      state.patch(AGENT, { status: 'sleeping' });
      scheduler.onRunClosed(AGENT);

      expect(woke).toEqual([
        { name: AGENT, trigger: 'slack', extra: 'review 42', job: true },
      ]);
    });

    it('ranks a person pressing run above a slack event, and slack above the ledger', () => {
      expect(
        triggerFor([
          { kind: 'ledger', id: 'a1', from: 'overmind' },
          { kind: 'slack.channel', id: '1757.1', from: 'U08' },
        ]),
      ).toBe('slack');

      expect(
        triggerFor([
          { kind: 'slack.channel', id: '1757.1', from: 'U08' },
          { kind: 'manual', id: 'm1', from: 'overmind', text: 'go' },
        ]),
      ).toBe('manual');
    });

    it('still reports manual for a manual entry, unaffected by the slack rank', () => {
      const started = scheduler.manualWake(AGENT, 'go');

      expect(started.started).toBe(true);
      expect(woke).toEqual([{ name: AGENT, trigger: 'manual', extra: 'go', job: true }]);
    });
  });

  describe('per-lane queues (HIVE-186)', () => {
    it('queues on the busy lane only, and flushes each lane into its own run', () => {
      liveLanes = new Set(['thread:A']);
      scheduler = build();
      state.patchLane(AGENT, 'thread:A', { pendingWake: [{ kind: 'answer', id: 'x1', from: 'overmind' }] });
      state.patchLane(AGENT, 'thread:B', { pendingWake: [{ kind: 'ask', id: 'B', from: 'overmind' }] });

      liveLanes.clear();
      scheduler.onRunClosed(AGENT);

      expect(woke).toEqual([
        { name: AGENT, trigger: 'ledger', extra: 'answer x1 from overmind', lane: 'thread:A' },
        { name: AGENT, trigger: 'ledger', extra: 'ask B from overmind', lane: 'thread:B' },
      ]);
      expect(state.lane(AGENT, 'thread:A').pendingWake).toEqual([]);
      expect(state.lane(AGENT, 'thread:B').pendingWake).toEqual([]);
    });

    it('stops draining at the first saturated refusal and keeps the rest queued', () => {
      state.patchLane(AGENT, 'thread:A', { pendingWake: [{ kind: 'ask', id: 'A', from: 'overmind' }] });
      state.patchLane(AGENT, 'thread:B', { pendingWake: [{ kind: 'ask', id: 'B', from: 'overmind' }] });
      refuseAfter = 0;

      scheduler.onRunClosed(AGENT);

      expect(runCalls).toBe(1);
      expect(state.lane(AGENT, 'thread:A').pendingWake).toHaveLength(1);
      expect(state.lane(AGENT, 'thread:B').pendingWake).toHaveLength(1);
    });

    it('re-homes a closed thread lane\'s queue onto standing', () => {
      state.patchLane(AGENT, 'thread:A', { closedAt: 5, pendingWake: [{ kind: 'post', id: 'p', from: 'overmind' }] });

      scheduler.onRunClosed(AGENT);

      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'post p from overmind' }]);
      expect(state.lane(AGENT, 'thread:A').pendingWake).toEqual([]);
    });
  });

  describe('draining lanes safely (HIVE-186)', () => {
    it('does not re-drain the lanes when a failed spawn re-enters the flush', () => {
      state.patch(AGENT, { pendingWake: [{ kind: 'ask', id: 's', from: 'overmind' }] });
      state.patchLane(AGENT, 'thread:A', { pendingWake: [{ kind: 'ask', id: 'A', from: 'overmind' }] });
      refuse = 'invalid';
      reenter = true;

      scheduler.onRunClosed(AGENT);

      expect(runCalls).toBe(2);
      expect(state.read(AGENT).pendingWake).toHaveLength(1);
      expect(state.lane(AGENT, 'thread:A').pendingWake).toHaveLength(1);
    });

    it('moves only what fits from a closed lane, and keeps the rest on it', () => {
      const full = Array.from({ length: AGENT_PENDING_WAKE_MAX - 1 }, (_, i) => ({ kind: 'ask', id: `s${String(i)}`, from: 'overmind' }));
      state.patch(AGENT, { pendingWake: full });
      state.patchLane(AGENT, 'thread:A', {
        closedAt: 5,
        pendingWake: [{ kind: 'manual', id: 'run', from: 'overmind', text: 'one' }, { kind: 'manual', id: 'run', from: 'overmind', text: 'two' }],
      });
      refuse = 'working';

      scheduler.onRunClosed(AGENT);

      expect(state.read(AGENT).pendingWake).toHaveLength(AGENT_PENDING_WAKE_MAX);
      expect(state.lane(AGENT, 'thread:A').pendingWake).toEqual([{ kind: 'manual', id: 'run', from: 'overmind', text: 'two' }]);
    });
  });

  describe('routing by lane (HIVE-186)', () => {
    const begun = (run: string, lane: string): LedgerEntry =>
      entry({ id: `s-${run}`, from: AGENT, to: undefined, kind: 'event', body: 'run.started — ledger', meta: { run, lane } });

    beforeEach(() => {
      laneMode = 'thread';
      liveLanes = new Set();
      scheduler = build();
    });

    it('starts lane B at once while lane A is busy', () => {
      liveLanes?.add('thread:A');
      const ask = entry({ id: 'B' });
      entries.push(entry({ id: 'A' }), ask);

      scheduler.onEntry(ask);

      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'ask B from overmind', lane: 'thread:B' }]);
    });

    it('queues the answer to lane A\'s question behind A, not B, then resumes A', () => {
      liveLanes?.add('thread:A').add('thread:B');
      const answer = entry({ id: 'ans', kind: 'answer', thread: 'Q' });
      entries.push(
        entry({ id: 'A' }), entry({ id: 'B' }), begun('r1', 'thread:A'),
        entry({ id: 'Q', from: AGENT, to: 'overmind', meta: { run: 'r1' } }), answer,
      );

      scheduler.onEntry(answer);
      expect(woke).toEqual([]);
      expect(state.lane(AGENT, 'thread:A').pendingWake).toEqual([
        { kind: 'answer', id: 'ans', from: 'overmind', thread: 'Q' },
      ]);

      liveLanes?.delete('thread:B');
      scheduler.onRunClosed(AGENT);
      expect(woke).toEqual([]); // B closing does not resume A: A is still live

      liveLanes?.delete('thread:A');
      scheduler.onRunClosed(AGENT);
      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'answer ans from overmind', lane: 'thread:A' }]);
    });

    it('wakes a different lane with a self-entry, never its own', () => {
      laneMode = 'repo';
      scheduler = build();
      entries.push(begun('r0', 'standing'));
      const handover = entry({ id: 'H', from: AGENT, meta: { run: 'r0', repo: 'a/x' } });
      entries.push(handover);

      scheduler.onEntry(handover);
      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: `ask H from ${AGENT}`, lane: 'repo:a/x' }]);

      woke = [];
      entries.push(begun('r1', 'repo:a/x'));
      const own = entry({ id: 'H2', from: AGENT, meta: { run: 'r1', repo: 'a/x' } });
      entries.push(own);
      scheduler.onEntry(own);
      expect(woke).toEqual([]);
    });

    it('answers a repo-laned ask with no meta.repo at once, as the overmind, and wakes nothing', () => {
      laneMode = 'repo';
      scheduler = build();
      const ask = entry({ id: 'N', from: 'sess-1' });
      entries.push(ask);

      scheduler.onEntry(ask);

      expect(woke).toEqual([]);
      expect(appended).toEqual([
        { from: 'overmind', to: 'sess-1', kind: 'answer', thread: 'N',
          body: `${AGENT} lanes by repository; send meta.repo as owner/name.` },
      ]);
    });

    it('routes a released held ask into the lane it opens', () => {
      const held = entry({ id: 'h1', meta: { after: 'a/b#3' } });
      const closed = entry({ id: 'c3', from: 'shipper', to: 'sess-4l', kind: 'post', body: 'merged', meta: { pr: 3, repo: 'a/b', stage: 'closed' } });
      entries.push(held, closed);

      scheduler.onEntry(closed);

      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'ask h1 from overmind', lane: 'thread:h1' }]);
    });

    it('routes an expired ask\'s news to the lane that asked it', () => {
      entries.push(
        begun('r1', 'thread:A'),
        { id: 'a1', ts: 0, from: AGENT, to: 'overmind', kind: 'ask', ref: 'a7', body: 'which branch?', meta: { run: 'r1' } },
      );
      clock = LEDGER_ASK_TTL_MS;

      scheduler.start();
      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'expired a1 from overmind — your ask a7 expired unanswered', lane: 'thread:A' }]);
    });

    it('sends an expiry to standing when the asking lane has closed', () => {
      entries.push(
        entry({ id: 'A' }),
        entry({ id: 'd', kind: 'done', from: AGENT, to: 'overmind', thread: 'A' }),
        begun('r1', 'thread:A'),
        { id: 'a1', ts: 0, from: AGENT, to: 'overmind', kind: 'ask', ref: 'a7', body: 'which branch?', meta: { run: 'r1' } },
      );
      clock = LEDGER_ASK_TTL_MS;

      scheduler.start();
      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'ledger', extra: 'expired a1 from overmind — your ask a7 expired unanswered' }]);
    });
  });

  describe('a thread lane closes with its ask (HIVE-186)', () => {
    beforeEach(() => {
      laneMode = 'thread';
      liveLanes = new Set();
      scheduler = build();
    });

    it('closes the thread lane when its opening ask is answered, and keeps its record', () => {
      state.patchLane(AGENT, 'thread:A', { sessionUuid: 'u-A', runsSinceRotate: 2 });
      const reply = entry({ id: 'r', from: AGENT, to: 'overmind', kind: 'answer', thread: 'A' });
      entries.push(entry({ id: 'A' }), reply);
      clock = 42;

      scheduler.onEntry(reply);

      expect(state.lane(AGENT, 'thread:A')).toEqual({ sessionUuid: 'u-A', runsSinceRotate: 2, closedAt: 42 });
    });

    it('does not open a record for a lane that never ran', () => {
      const reply = entry({ id: 'r', from: AGENT, to: 'overmind', kind: 'answer', thread: 'A' });
      entries.push(entry({ id: 'A' }), reply);

      scheduler.onEntry(reply);

      expect(state.read(AGENT).lanes).toBeUndefined();
    });

    it('closes the thread lane when its opening ask expires', () => {
      state.patchLane(AGENT, 'thread:a1', { sessionUuid: 'u-1', runsSinceRotate: 0 });
      entries.push(entry({ id: 'a1', ts: 0 }));
      clock = LEDGER_ASK_TTL_MS;

      scheduler.start();
      tick();

      expect(state.lane(AGENT, 'thread:a1').closedAt).toBe(LEDGER_ASK_TTL_MS);
    });
  });

  describe('repo lane clocks (HIVE-186)', () => {
    const holding = (): void => {
      state.patchLane(AGENT, 'repo:a/x', { runsSinceRotate: 0 });
      state.patchLane(AGENT, 'repo:b/y', { runsSinceRotate: 0, nextRunAt: 1 });
      entries.push(
        entry({ id: 's1', from: AGENT, to: undefined, kind: 'event', body: 'run.started — ledger', meta: { run: 'r1', lane: 'repo:a/x' } }),
        entry({ id: 'c1', from: AGENT, to: undefined, kind: 'claim', body: 'claimed a/x#1', meta: { task: 'a/x#1', run: 'r1' } }),
      );
    };

    beforeEach(() => {
      laneMode = 'repo';
      liveLanes = new Set();
      scheduler = build();
      schedules.set(AGENT, { wake: { everyMs: 600_000, on: ['ledger'], check: 'onchange' } as WakeSpec });
      scheduler.start();
    });

    const accepted = (): void => {
      state.patchLane(AGENT, 'repo:a/x', { runsSinceRotate: 0 });
      entries.push(
        entry({ id: 'k1', from: 'sess-1', kind: 'ask', body: 'Ship PR #1 on a/x', meta: { repo: 'a/x', pr: 1 } }),
        entry({ id: 's1', from: AGENT, to: undefined, kind: 'event', body: 'run.started — ledger', meta: { run: 'r1', lane: 'repo:a/x', wakes: ['k1'] } }),
        entry({ id: 'k2', from: AGENT, to: 'sess-1', kind: 'post', thread: 'k1', body: 'accepted', meta: { accepted: true, run: 'r1' } }),
        entry({ id: 'e1', from: AGENT, to: undefined, kind: 'event', body: 'run.ended — done', meta: { run: 'r1', outcome: 'done' } }),
      );
    };
    const card = (): LedgerEntry =>
      entry({ id: 'p1', from: AGENT, to: 'overmind', kind: 'ask', body: 'undo ready on a/x#1?', meta: { run: 'r1', kind: 'permission' } });

    it('ticks a lane that accepted an ask and holds no claim, and the ask stays accepted (HIVE-410)', () => {
      accepted();

      tick();
      clock = 600_000;
      tick();

      expect(askStates(entries, clock).find((item) => item.ask.id === 'k1')?.state).toBe('accepted');
      expect(woke).toContainEqual({ name: AGENT, trigger: 'interval', lane: 'repo:a/x' });
    });

    it('does not tick a lane whose one accepted ask waits on its own permission card (HIVE-410)', () => {
      accepted();
      entries.push(card());

      tick();
      clock = 600_000;
      tick();

      expect(woke.some((w) => w.lane === 'repo:a/x')).toBe(false);
      expect(state.lane(AGENT, 'repo:a/x').nextRunAt).toBe(1_200_000);
    });

    it('ticks again once that card was closed as moot (HIVE-410)', () => {
      accepted();
      entries.push(
        card(),
        entry({ id: 'm1', from: 'overmind', to: AGENT, kind: 'answer', thread: 'p1', body: 'moot', meta: { moot: 'a/x#1 merged' } }),
      );

      tick();
      clock = 600_000;
      tick();

      expect(woke).toContainEqual({ name: AGENT, trigger: 'interval', lane: 'repo:a/x' });
    });

    it('ticks a repo lane that holds a claim, and leaves an idle one without a clock', () => {
      holding();

      tick(); // arms repo:a/x
      clock = 600_000;
      tick(); // fires it

      expect(woke).toContainEqual({ name: AGENT, trigger: 'interval', lane: 'repo:a/x' });
      expect(woke.some((w) => w.lane === 'repo:b/y')).toBe(false);
      expect(state.lane(AGENT, 'repo:b/y').nextRunAt).toBeUndefined();
    });

    it('gives a repo agent no standing interval wake, and still ticks its claimed lane (HIVE-408)', () => {
      holding();

      tick();
      clock = 600_000;
      tick();

      expect(woke.some((w) => w.lane === undefined)).toBe(false);
      expect(woke).toContainEqual({ name: AGENT, trigger: 'interval', lane: 'repo:a/x' });
      expect(state.read(AGENT).nextRunAt).toBeUndefined();
    });

    it('wakes a calendar-only repo agent on the standing lane at its time (HIVE-412)', () => {
      const NOON = new Date(2026, 7, 31, 12).getTime();
      clock = NOON;
      schedules.set(AGENT, { wake: { at: ['09:00'], on: [] } });
      state.patch(AGENT, { nextRunAt: NOON });

      tick();

      expect(woke).toEqual([{ name: AGENT, trigger: 'schedule' }]);
      expect(state.read(AGENT).nextRunAt).toBe(new Date(2026, 8, 1, 9).getTime());
    });

    it('does not tick a lane whose one claim waits on its own permission card (HIVE-408)', () => {
      holding();
      entries.push(entry({ id: 'p1', from: AGENT, to: 'overmind', kind: 'ask', body: 'merge a/x#1?', meta: { run: 'r1', kind: 'permission' } }));

      tick();
      clock = 600_000;
      tick();

      expect(woke.some((w) => w.lane === 'repo:a/x')).toBe(false);
      expect(state.lane(AGENT, 'repo:a/x').nextRunAt).toBe(1_200_000);
    });

    it('still ticks a lane holding a second claim beside the card (HIVE-408)', () => {
      holding();
      entries.push(
        entry({ id: 'c2', from: AGENT, to: undefined, kind: 'claim', body: 'claimed a/x#2', meta: { task: 'a/x#2', run: 'r1' } }),
        entry({ id: 'p1', from: AGENT, to: 'overmind', kind: 'ask', body: 'merge a/x#1?', meta: { run: 'r1', kind: 'permission' } }),
      );

      tick();
      clock = 600_000;
      tick();

      expect(woke).toContainEqual({ name: AGENT, trigger: 'interval', lane: 'repo:a/x' });
    });

    it('still ticks a lane whose one claim waits on a plain question, not a card (HIVE-408)', () => {
      holding();
      entries.push(entry({ id: 'q1', from: AGENT, to: 'sess-1', kind: 'ask', body: 'which branch?', meta: { run: 'r1' } }));

      tick();
      clock = 600_000;
      tick();

      expect(woke).toContainEqual({ name: AGENT, trigger: 'interval', lane: 'repo:a/x' });
    });

    it('does not tick a lane that is running', () => {
      holding();

      tick();
      clock = 600_000;
      liveLanes?.add('repo:a/x');
      tick();

      expect(woke.some((w) => w.lane === 'repo:a/x')).toBe(false);
    });

    it('does not tick a paused agent\'s repo lanes', () => {
      holding();

      tick();
      state.patch(AGENT, { status: 'paused' });
      clock = 600_000;
      tick();

      expect(woke).toEqual([]);
    });
  });

  it('clears a closed thread lane and its directory a day after it closed (HIVE-188)', () => {
    scheduler.start();
    state.patchLane(AGENT, 'thread:A', { runsSinceRotate: 1, closedAt: 0 });
    state.patchLane(AGENT, 'thread:B', { runsSinceRotate: 1, closedAt: 1_000 });

    clock = 24 * 60 * 60 * 1000;
    tick();

    expect(removed).toEqual([`${AGENT}:thread:A`]);
    expect(Object.keys(state.read(AGENT).lanes ?? {})).toEqual(['thread:B']);
  });

  describe('a budget-held queue (HIVE-187)', () => {
    const cappedDay = dayKey(new Date(1970, 0, 1, 12).getTime());

    it('flushes on the first sweep of a new day', () => {
      scheduler.start();
      state.patch(AGENT, {
        today: { day: cappedDay, runs: 3, usd: 5, capped: true },
        pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
      });
      clock = new Date(1970, 0, 2, 9).getTime(); // a local day later

      tick();

      expect(woke).toContainEqual({ name: AGENT, trigger: 'ledger', extra: 'ask a9 from overmind' });
      expect(state.read(AGENT).today).toEqual({ day: dayKey(clock), runs: 0, usd: 0 });
    });

    it('leaves it queued while the day is still the capped one', () => {
      scheduler.start();
      clock = new Date(1970, 0, 1, 12).getTime();
      state.patch(AGENT, {
        today: { day: cappedDay, runs: 3, usd: 5, capped: true },
        pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
      });

      tick();

      expect(woke.some((w) => w.extra === 'ask a9 from overmind')).toBe(false);
    });

    it('clears a paused agent\'s stale cap without waking it', () => {
      scheduler.start();
      state.patch(AGENT, {
        status: 'paused',
        today: { day: cappedDay, runs: 3, usd: 5, capped: true },
        pendingWake: [{ kind: 'ask', id: 'a9', from: 'overmind' }],
      });
      clock = new Date(1970, 0, 2, 9).getTime();

      tick();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).today?.capped).toBeUndefined();
    });
  });

  describe('licence lapse (HIVE-267)', () => {
    const HOUR = 60 * 60_000;
    const hourly: WakeSpec = { everyMs: HOUR, check: 'always', on: [] };

    it('a schedule due while lapsed does not run, then or after renewal, and its next regular tick runs', () => {
      scheduler.start();
      schedules.set(AGENT, { wake: hourly });
      state.patch(AGENT, { nextRunAt: 60_000 });

      lapsed = true;
      clock = 2 * 60_000;
      tick();
      expect(woke).toEqual([]);
      expect(state.read(AGENT).nextRunAt).toBeGreaterThan(clock);

      lapsed = false;
      clock = 4 * 60_000;
      tick();
      expect(woke).toEqual([]); // not caught up on renewal

      clock = 2 * 60_000 + HOUR;
      tick();
      expect(woke).toEqual([{ name: AGENT, trigger: 'interval' }]); // the next regular tick
    });

    it('the launch catch-up tick skips too while lapsed', () => {
      schedules.set(AGENT, { wake: hourly });
      state.patch(AGENT, { nextRunAt: 1 });
      clock = 10 * HOUR;
      lapsed = true;

      scheduler.start();

      expect(woke).toEqual([]);
      expect(state.read(AGENT).nextRunAt).toBeGreaterThan(clock);
    });

    it('a repo lane due while lapsed re-arms without running', () => {
      laneMode = 'repo';
      liveLanes = new Set();
      scheduler = build();
      schedules.set(AGENT, { wake: { everyMs: 600_000, on: ['ledger'], check: 'onchange' } as WakeSpec });
      scheduler.start();
      state.patchLane(AGENT, 'repo:a/x', { runsSinceRotate: 0 });
      entries.push(
        entry({ id: 's1', from: AGENT, to: undefined, kind: 'event', body: 'run.started — ledger', meta: { run: 'r1', lane: 'repo:a/x' } }),
        entry({ id: 'c1', from: AGENT, to: undefined, kind: 'claim', body: 'claimed a/x#1', meta: { task: 'a/x#1', run: 'r1' } }),
      );
      tick(); // arms repo:a/x

      lapsed = true;
      clock = 600_000;
      tick();

      expect(woke.some((w) => w.lane === 'repo:a/x')).toBe(false);
      expect(state.lane(AGENT, 'repo:a/x').nextRunAt).toBeGreaterThan(clock);
    });
  });

  describe('a re-wake no run was started for (HIVE-410)', () => {
    const ask = entry({ id: 'k1', from: 'sess-1', kind: 'ask', body: 'Ship PR #1' });
    const rewake = entry({
      id: 'w1', from: 'overmind', kind: 'post', thread: 'k1',
      body: 'You owe an answer to k1', meta: { rewoke: 'k1' },
    });

    it('is routed at start', () => {
      entries = [ask, rewake];

      scheduler.start();

      expect(wakeIds).toEqual([['w1']]);
    });

    it('is left alone once a run was started for it', () => {
      entries = [
        ask,
        rewake,
        entry({ id: 's2', from: AGENT, to: undefined, kind: 'event', body: 'run.started — ledger', meta: { run: 'r2', wakes: ['w1'] } }),
      ];

      scheduler.start();

      expect(wakeIds).toEqual([]);
    });

    it('is left alone once its ask closed', () => {
      entries = [ask, rewake, entry({ id: 'n1', from: AGENT, to: 'sess-1', kind: 'answer', thread: 'k1', body: 'merged' })];

      scheduler.start();

      expect(wakeIds).toEqual([]);
    });

    it('is left to the flush while it stands in a queue', () => {
      entries = [ask, rewake];
      state.patch(AGENT, { pendingWake: [{ kind: 'post', id: 'w1', from: 'overmind' }] });
      refuse = 'working';

      scheduler.start();

      expect(state.read(AGENT).pendingWake).toEqual([{ kind: 'post', id: 'w1', from: 'overmind' }]);
    });
  });

  describe('watchdog (HIVE-411)', () => {
    /** An ask from the agent to a session, nudged at ts 1 and never served. */
    const unpicked = (): LedgerEntry => {
      const ask = entry({ id: '20261113-000000-0001', from: AGENT, to: 'sess-1', ref: 'a40', ts: 0 });
      entries.push(ask, entry({ id: '20261113-000000-0002', kind: 'event', from: 'overmind', to: 'sess-1', ts: 1, body: 'nudge written', meta: { delivered: ask.id } }));
      return ask;
    };

    /** sess-0a asked the agent; run r1 was woken for it and accepted it at ts 5. */
    const accepted = (meta: Record<string, unknown> = {}, lane?: string): LedgerEntry => {
      const ask = entry({ id: '20261113-000000-0001', from: 'sess-0a', to: AGENT, ref: 'a50', ts: 0, meta });
      entries.push(
        ask,
        entry({ id: '20261113-000000-0002', from: AGENT, to: undefined, kind: 'event', ts: 1, body: 'run.started — ledger', meta: { run: 'r1', wakes: [ask.id], ...(lane === undefined ? {} : { lane }) } }),
        entry({ id: '20261113-000000-0003', from: AGENT, to: 'sess-0a', kind: 'post', thread: ask.id, ts: 5, body: 'accepted', meta: { accepted: true, run: 'r1' } }),
      );
      return ask;
    };

    const watchWrites = (): LedgerPostRequest[] => appended.filter((request) => request.meta?.['watch'] !== undefined);

    /** Land what the sweep appended in the log it reads next, as the real ledger would. */
    const settle = (): void => {
      for (const request of appended.splice(0)) {
        entries.push(entry({ ...request, id: `20261113-000100-${String(entries.length).padStart(4, '0')}`, ts: clock }) as LedgerEntry);
      }
    };

    it('re-nudges once across sweeps, and retries after a failed write', () => {
      unpicked();
      clock = 1 + RENUDGE_AFTER_MS;
      appendOk = false;
      scheduler = build();
      scheduler.start();
      tick();
      expect(flushed).toEqual([]);
      appended.length = 0; // a refused write never reached the log

      appendOk = true;
      clock += 60_000;
      tick();
      settle();
      clock += 60_000;
      tick();

      expect(flushed).toEqual(['sess-1']);
      expect(watchWrites()).toEqual([]);
    });

    it('re-nudges: writes the marker on the ask’s thread, then flushes the session', () => {
      const ask = unpicked();
      clock = 1 + RENUDGE_AFTER_MS;
      scheduler = build();
      scheduler.start();
      tick();

      expect(appended).toContainEqual(expect.objectContaining({ from: 'overmind', to: 'sess-1', kind: 'event', thread: ask.id, meta: { watch: 'renudge', watched: ask.id } }));
      expect(flushed).toEqual(['sess-1']);
    });

    it('does not flush when the marker could not be written', () => {
      unpicked();
      clock = 1 + RENUDGE_AFTER_MS;
      appendOk = false;
      scheduler = build();
      scheduler.start();
      tick();

      expect(watchWrites()).toHaveLength(1);
      expect(flushed).toEqual([]);
    });

    it('raises the card as an overmind ask with a key and a Dismiss option', () => {
      const ask = unpicked();
      const markTs = 1 + RENUDGE_AFTER_MS;
      entries.push(entry({ id: '20261113-000000-0003', kind: 'event', from: 'overmind', to: 'sess-1', thread: ask.id, ts: markTs, body: 're-nudge (a40)', meta: { watch: 'renudge', watched: ask.id } }));
      clock = markTs + CARD_AFTER_MS;
      scheduler = build();
      scheduler.start();
      tick();

      expect(appended).toContainEqual(expect.objectContaining({
        from: 'overmind', to: 'overmind', kind: 'ask',
        meta: expect.objectContaining({ watch: 'card', watched: ask.id, options: ['Dismiss'], key: `watch:card:${ask.id}` }),
      }));
      expect(flushed).toEqual([]);
    });

    it('re-wakes: posts to the agent on the ask’s thread', () => {
      const ask = accepted();
      schedules.set(AGENT, { wake: { everyMs: 5 * 60_000, on: ['ledger'], check: 'onchange' } as WakeSpec });
      liveLanes = new Set();
      clock = 5 + 15 * 60_000;
      scheduler = build();
      scheduler.start();
      tick();

      expect(appended).toContainEqual(expect.objectContaining({ from: 'overmind', to: AGENT, kind: 'post', thread: ask.id, meta: { watch: 'rewake', watched: ask.id } }));
    });

    it('uses 30 minutes for an agent with no interval', () => {
      const ask = accepted();
      liveLanes = new Set();
      clock = 5 + 15 * 60_000;
      scheduler = build();
      scheduler.start();
      tick();
      expect(watchWrites()).toEqual([]);

      clock = 5 + QUIET_LANE_FALLBACK_MS;
      tick();
      expect(watchWrites()).toEqual([
        expect.objectContaining({ from: 'overmind', to: AGENT, kind: 'post', thread: ask.id, meta: { watch: 'rewake', watched: ask.id } }),
      ]);
    });

    it('tells the asker about a silent run', () => {
      const ask = accepted();
      live = [{ agent: AGENT, run: 'r1', lane: 'standing', startedAt: 0 }];
      liveLanes = new Set(['standing']);
      clock = QUIET_RUN_MS + 10;
      scheduler = build();
      scheduler.start();
      tick();

      expect(appended).toContainEqual(expect.objectContaining({ from: 'overmind', to: 'sess-0a', kind: 'post', thread: ask.id, meta: { watch: 'quiet', watched: ask.id, run: 'r1' } }));
      expect(watchWrites()).toHaveLength(1);
    });

    it('routes the re-wake post to the repo lane the ask opened, with no interval tick', () => {
      laneMode = 'repo';
      liveLanes = new Set();
      scheduler = build();
      const ask = accepted({ repo: 'behiques/hivetty-cloud', pr: 40 }, 'repo:behiques/hivetty-cloud');
      const post = entry({
        id: '20261113-000000-0004', ts: 5 + QUIET_LANE_FALLBACK_MS,
        from: 'overmind', to: AGENT, kind: 'post', thread: ask.id,
        body: 'a50 is accepted and its lane has gone quiet: pick it back up, or answer it',
        meta: { watch: 'rewake', watched: ask.id },
      });
      entries.push(post);

      scheduler.onEntry(post);

      expect(woke).toContainEqual(expect.objectContaining({ name: AGENT, lane: 'repo:behiques/hivetty-cloud' }));
    });

    describe('the watch card closes, and the audit replays', () => {
      /** The unpicked ask, its re-nudge marker, and the watch card raised 15 minutes later. */
      const carded = (): { ask: LedgerEntry; card: LedgerEntry } => {
        const ask = unpicked();
        const markTs = 1 + RENUDGE_AFTER_MS;
        const card = entry({ id: '20261113-000000-0004', from: 'overmind', to: 'overmind', kind: 'ask', ref: 'a41', ts: markTs + CARD_AFTER_MS, body: 'not picked up', meta: { watch: 'card', watched: ask.id, options: ['Dismiss'], key: `watch:card:${ask.id}` } });
        entries.push(
          entry({ id: '20261113-000000-0003', kind: 'event', from: 'overmind', to: 'sess-1', thread: ask.id, ts: markTs, body: 're-nudge (a40)', meta: { watch: 'renudge', watched: ask.id } }),
          card,
        );
        return { ask, card };
      };

      it('answers the card moot once its ask is picked up', () => {
        const { ask, card } = carded();
        clock = card.ts + 60_000;
        scheduler = build();
        scheduler.start();
        tick();
        expect(appended.some((request) => request.thread === card.id)).toBe(false);

        appended.length = 0;
        entries.push(entry({ id: '20261113-000000-0005', kind: 'event', from: 'overmind', to: 'sess-1', ts: clock, body: 'served', meta: { served: ask.id } }));
        clock += 60_000;
        tick();

        expect(appended).toContainEqual(expect.objectContaining({ from: 'overmind', kind: 'answer', thread: card.id, meta: { moot: 'a40 was picked up' } }));
      });

      it('a26 budget hold: one refusal note, and no watchdog step on top of it', () => {
        refuse = 'budget';
        scheduler = build();
        scheduler.start();
        const ask = entry({ id: '20261113-000000-0001', from: 'sess-0a', to: AGENT, ref: 'a26', ts: 0, body: 'Build it' });
        entries.push(ask);
        scheduler.onEntry(ask);
        settle();

        clock = 60_000;
        tick();
        settle();
        clock = 2 * 60 * 60_000;
        tick();
        settle();

        const notes = entries.filter((item) => item.meta?.['refused'] !== undefined);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ from: 'overmind', to: 'sess-0a', thread: ask.id, meta: { refused: 'budget' } });
        expect(entries.filter((item) => item.meta?.['watch'] !== undefined)).toEqual([]);
      });

      it('hivetty-cloud#40: one re-wake for a quiet repo lane, and nothing more a minute later', () => {
        laneMode = 'repo';
        liveLanes = new Set();
        schedules.set(AGENT, { wake: { everyMs: 5 * 60_000, on: ['ledger'], check: 'onchange' } as WakeSpec });
        scheduler = build();
        const ask = accepted({ repo: 'behiques/hivetty-cloud', pr: 40 }, 'repo:behiques/hivetty-cloud');
        clock = 5 + 15 * 60_000;
        scheduler.start();
        tick();
        expect(watchWrites()).toEqual([
          expect.objectContaining({ from: 'overmind', to: AGENT, kind: 'post', thread: ask.id, meta: { watch: 'rewake', watched: ask.id } }),
        ]);

        settle();
        clock += 60_000;
        tick();
        expect(watchWrites()).toEqual([]);
      });

      it('card a84: a 15-minute-old permission card gets no watchdog step', () => {
        entries.push(entry({ id: '20261113-000000-0001', from: 'shipper', to: 'overmind', ref: 'a84', ts: 0, body: 'merge a/x#1?', meta: { kind: 'permission', run: 'r1' } }));
        clock = 15 * 60_000;
        scheduler = build();
        scheduler.start();
        tick();

        expect(watchWrites()).toEqual([]);
      });
    });
  });
});

describe('mootCards: the watch card (HIVE-411)', () => {
  const ask = entry({ id: '20261113-000000-0001', from: AGENT, to: 'sess-1', ref: 'a40', ts: 0 });
  const log = [
    ask,
    entry({ id: '20261113-000000-0002', kind: 'event', from: 'overmind', to: 'sess-1', ts: 1, body: 'nudge written', meta: { delivered: ask.id } }),
    entry({ id: '20261113-000000-0003', kind: 'event', from: 'overmind', to: 'sess-1', thread: ask.id, ts: 61_001, body: 're-nudge', meta: { watch: 'renudge', watched: ask.id } }),
    entry({ id: '20261113-000000-0004', kind: 'ask', from: 'overmind', to: 'overmind', ref: 'a41', ts: 961_001, body: 'not picked up', meta: { watch: 'card', watched: ask.id } }),
  ];

  it('keeps the card while its ask is still unpicked', () => {
    expect(mootCards(log, 1_000_000)).toEqual([]);
  });

  it('closes it once the ask was served', () => {
    const served = entry({ id: '20261113-000000-0005', kind: 'event', from: 'overmind', to: 'sess-1', ts: 970_000, body: 'served', meta: { served: ask.id } });
    expect(mootCards([...log, served], 1_000_000).map(({ ask: card, reason }) => ({ id: card.id, reason }))).toEqual([
      { id: '20261113-000000-0004', reason: 'a40 was picked up' },
    ]);
  });

  it('ignores a card-shaped ask another party wrote', () => {
    const forged = entry({ id: '20261113-000000-0006', kind: 'ask', from: 'sess-1', to: 'overmind', ts: 970_000, body: 'x', meta: { watch: 'card', watched: ask.id } });
    const served = entry({ id: '20261113-000000-0005', kind: 'event', from: 'overmind', to: 'sess-1', ts: 970_000, body: 'served', meta: { served: ask.id } });
    expect(mootCards([...log, served, forged], 1_000_000).map((item) => item.ask.id)).toEqual(['20261113-000000-0004']);
  });
});
