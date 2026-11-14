// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { acceptedLanes, askRefusal, decide, decideForEvent, laneClaims, laneFor } from '../../../../electron/main/agents/scheduler-rules';
import type { AgentStatus } from '../../../../electron/shared/agent-contract';
import type { LedgerEntry } from '../../../../electron/shared/ledger-contract';

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

describe('decide', () => {
  it('ignores an accept: the asker is free and has nothing to act on (HIVE-410)', () => {
    expect(decide('sleeping', entry({ kind: 'post', meta: { accepted: true } }))).toBe('ignore');
    expect(decide('sleeping', entry({ kind: 'post', meta: { accepted: false } }))).toBe('wake');
  });

  it('wakes an agent that is not running', () => {
    const resting: AgentStatus[] = ['sleeping', 'asking', 'failed'];

    for (const status of resting) {
      expect(decide(status, entry())).toBe('wake');
    }
  });

  it('queues while the agent is working', () => {
    expect(decide('working', entry())).toBe('queue');
  });

  it('holds while the agent is paused', () => {
    expect(decide('paused', entry())).toBe('hold');
  });

  it('wakes on every addressed kind that is news', () => {
    for (const kind of ['ask', 'answer', 'done', 'failed', 'post'] as const) {
      expect(decide('sleeping', entry({ kind }))).toBe('wake');
    }
  });

  it('ignores an event — that is the loop guard, not a filter', () => {
    // The scheduler appends events itself (the expiry sweep), and every wake
    // it causes appends `run.started` and `run.ended`. Waking on an event
    // would make each wake cause the next one.
    expect(decide('sleeping', entry({ kind: 'event' }))).toBe('ignore');
  });

  it('ignores the bookkeeping kinds', () => {
    for (const kind of ['claim', 'release', 'handoff'] as const) {
      expect(decide('sleeping', entry({ kind }))).toBe('ignore');
    }
  });

  it('ignores a broadcast — parties read those on their next wake', () => {
    expect(decide('sleeping', entry({ to: undefined }))).toBe('ignore');
  });

  it('ignores an entry the agent addressed to itself', () => {
    expect(decide('sleeping', entry({ from: AGENT, to: AGENT }))).toBe('ignore');
  });

  it('ignores a kind it does not wake on before it reads the status', () => {
    // The kind gate is not conditional on the agent's state: a paused agent
    // receiving an `event` queues nothing, or the queue would fill with
    // entries that could never have woken it.
    expect(decide('paused', entry({ kind: 'event' }))).toBe('ignore');
    expect(decide('working', entry({ kind: 'claim' }))).toBe('ignore');
  });
});

describe('decideForEvent (HIVE-124)', () => {
  it('wakes a sleeping agent', () => {
    expect(decideForEvent('sleeping')).toBe('wake');
  });

  it('queues for a working one, so a burst becomes one wake', () => {
    expect(decideForEvent('working')).toBe('queue');
  });

  it('holds for a paused one, and resume delivers', () => {
    expect(decideForEvent('paused')).toBe('hold');
  });

  it('wakes an asking agent, which is not running', () => {
    expect(decideForEvent('asking')).toBe('wake');
  });
});

describe('laneFor (HIVE-186)', () => {
  const at = (over: Partial<LedgerEntry>): LedgerEntry => ({
    id: 'x', ts: 0, from: 'overmind', to: 'builder', kind: 'ask', body: 'b', ...over,
  });
  const started = (run: string, lane?: string): LedgerEntry =>
    at({ id: `s-${run}`, from: 'builder', to: undefined, kind: 'event', body: 'run.started — ledger',
         meta: { run, trigger: 'ledger', kind: 'standing', ...(lane === undefined ? {} : { lane }) } });

  // thread lanes
  it('opens a thread lane for a new ask', () => {
    expect(laneFor('thread', at({ id: 'A' }), [at({ id: 'A' })])).toEqual({ lane: 'thread:A' });
  });

  it('routes the answer to a lane\'s own question back into that lane', () => {
    const answer = at({ id: 'ans', from: 'overmind', to: 'builder', kind: 'answer', thread: 'Q' });
    const log = [
      at({ id: 'A' }),
      started('r1', 'thread:A'),
      at({ id: 'Q', from: 'builder', to: 'overmind', meta: { run: 'r1' } }),
      answer,
    ];
    expect(laneFor('thread', answer, log)).toEqual({ lane: 'thread:A' });
  });

  it('routes the answer to a sibling lane\'s question into the sibling', () => {
    const answer = at({ id: 'ans', from: 'overmind', to: 'builder', kind: 'answer', thread: 'QB' });
    const log = [
      at({ id: 'A' }), at({ id: 'B' }),
      started('r1', 'thread:A'), started('r2', 'thread:B'),
      at({ id: 'QB', from: 'builder', to: 'overmind', meta: { run: 'r2' } }),
      answer,
    ];
    expect(laneFor('thread', answer, log)).toEqual({ lane: 'thread:B' });
  });

  it('routes a follow-up in the thread of the ask that opened a lane into that lane', () => {
    const post = at({ id: 'p', kind: 'post', thread: 'A' });
    const log = [at({ id: 'A' }), post];
    expect(laneFor('thread', post, log)).toEqual({ lane: 'thread:A' });
  });

  it('routes into standing once the lane\'s opening ask has closed, but not for the closing entry itself', () => {
    const closing = at({ id: 'done', kind: 'done', thread: 'A' });
    const after = at({ id: 'late', kind: 'post', thread: 'A' });
    const log = [at({ id: 'A' }), closing, after];
    expect(laneFor('thread', closing, log)).toEqual({ lane: 'thread:A' });
    expect(laneFor('thread', after, log)).toEqual({ lane: 'standing' });
  });

  it('routes into standing once the lane\'s opening ask has expired (spec §1)', () => {
    const expired = at({ id: 'e', from: 'overmind', to: 'overmind', kind: 'event', thread: 'A', body: 'ask A expired', meta: { expired: 'A' } });
    const forged = at({ id: 'f', from: 'sess-1', to: 'builder', kind: 'event', thread: 'A', body: 'x', meta: { expired: 'A' } });
    const late = at({ id: 'late', kind: 'post', thread: 'A' });
    expect(laneFor('thread', late, [at({ id: 'A' }), forged, late])).toEqual({ lane: 'thread:A' });
    expect(laneFor('thread', late, [at({ id: 'A' }), expired, late])).toEqual({ lane: 'standing' });
  });

  // repo lanes
  it('shares one lane between two asks for the same repo, and not across repos', () => {
    const a = at({ id: 'A', meta: { repo: 'a/x' } });
    const b = at({ id: 'B', meta: { repo: 'a/x' } });
    const c = at({ id: 'C', meta: { repo: 'b/y' } });
    const log = [a, b, c];
    expect(laneFor('repo', a, log)).toEqual({ lane: 'repo:a/x' });
    expect(laneFor('repo', b, log)).toEqual({ lane: 'repo:a/x' });
    expect(laneFor('repo', c, log)).toEqual({ lane: 'repo:b/y' });
  });

  it('keys one repository as one lane, whatever its case (HIVE-189)', () => {
    const a = at({ id: 'A', meta: { repo: 'A/x' } });
    const b = at({ id: 'B', meta: { repo: 'a/X' } });
    expect(laneFor('repo', a, [a, b])).toEqual({ lane: 'repo:a/x' });
    expect(laneFor('repo', b, [a, b])).toEqual({ lane: 'repo:a/x' });
  });

  describe('a repo-less ask, by the claim (HIVE-189)', () => {
    const claim = (task: string, id = `c-${task}`): LedgerEntry =>
      at({ id, from: 'shipper', to: undefined, kind: 'claim', body: `claimed ${task}`, meta: { task } });

    it('routes an overmind "merge PR #253" into the lane of the one repo holding #253', () => {
      const ask = at({ id: 'M', to: 'shipper', body: 'merge PR #253' });
      const log = [claim('yunidbauza/the-hive#253'), claim('other/repo#12'), ask];
      expect(laneFor('repo', ask, log)).toEqual({ lane: 'repo:yunidbauza/the-hive' });
    });

    it('reads meta.pr when the body names no number', () => {
      const ask = at({ id: 'M', to: 'shipper', body: 'merge it', meta: { pr: 12 } });
      expect(laneFor('repo', ask, [claim('other/repo#12'), ask])).toEqual({ lane: 'repo:other/repo' });
    });

    it('lands on standing when no claim or two claims match, so the standing lane can ask which', () => {
      const ask = at({ id: 'M', to: 'shipper', body: 'merge PR #7' });
      expect(laneFor('repo', ask, [ask])).toEqual({ lane: 'standing' });
      expect(laneFor('repo', ask, [claim('a/x#7'), claim('b/y#7'), ask])).toEqual({ lane: 'standing' });
    });

    it('ignores a claim someone else holds, or one already released', () => {
      const ask = at({ id: 'M', to: 'shipper', body: 'merge PR #9' });
      const theirs = { ...claim('a/x#9'), from: 'sess-1' };
      const released = at({ id: 'r', from: 'shipper', to: undefined, kind: 'release', body: '', meta: { task: 'b/y#9' } });
      expect(laneFor('repo', ask, [theirs, claim('b/y#9'), released, ask])).toEqual({ lane: 'standing' });
    });

    it('counts one repository once, however its claims spell it', () => {
      const ask = at({ id: 'M', to: 'shipper', body: 'merge PR #5' });
      expect(laneFor('repo', ask, [claim('Owner/Repo#5'), claim('owner/repo#5'), ask])).toEqual({ lane: 'repo:owner/repo' });
    });

    it('still refuses a repo-less ask from anyone but the overmind', () => {
      const ask = at({ id: 'S', from: 'sess-1', to: 'shipper', body: 'ship it' });
      expect(laneFor('repo', ask, [ask])).toEqual({ refuse: 'shipper lanes by repository; send meta.repo as owner/name.' });
    });
  });

  it.each(['', '/abs/path', 'no-slash', 7])('refuses an ask with meta.repo %j, with a reason', (repo) => {
    const ask = at({ id: 'A', meta: repo === undefined ? {} : { repo } });
    expect(laneFor('repo', ask, [ask])).toEqual({
      refuse: 'builder lanes by repository; send meta.repo as owner/name.',
    });
  });

  describe('a post naming a repository (HIVE-412)', () => {
    it('routes a post with meta.repo to that repo lane, for a repo-laned agent only', () => {
      const post = at({ id: 'p', to: 'shipper', kind: 'post', meta: { repo: 'Acme/Hive', pr: 7, changed: ['checks'] } });
      expect(laneFor('repo', post, [post])).toEqual({ lane: 'repo:acme/hive' });
      expect(laneFor('thread', post, [post])).toEqual({ lane: 'standing' });
      expect(laneFor(undefined, post, [post])).toEqual({ lane: 'standing' });
    });

    it.each(['', '/abs/path', 'no-slash', 7, null])('sends a post with meta.repo %j to standing, never a refusal', (repo) => {
      const post = at({ id: 'p', to: 'shipper', kind: 'post', meta: { repo } });
      expect(laneFor('repo', post, [post])).toEqual({ lane: 'standing' });
    });

    it('routes only a post: another kind with meta.repo and no thread stays on standing', () => {
      for (const kind of ['answer', 'done', 'failed', 'event'] as const) {
        const item = at({ id: 'e', to: 'shipper', kind, meta: { repo: 'acme/hive' } });
        expect(laneFor('repo', item, [item])).toEqual({ lane: 'standing' });
      }
    });

    it('leaves a threaded post to its thread, whatever meta.repo it names', () => {
      const ask = at({ id: 'A', to: 'shipper', meta: { repo: 'a/x' } });
      const post = at({ id: 'p', to: 'shipper', kind: 'post', thread: 'A', meta: { repo: 'b/y' } });
      expect(laneFor('repo', post, [ask, post])).toEqual({ lane: 'repo:a/x' });
    });
  });

  // everything else
  it('sends broadcasts, laneless entries and every entry of a pre-lane agent to standing', () => {
    const ask = at({ id: 'A' });
    expect(laneFor('thread', at({ id: 'bc', to: undefined, kind: 'post' }), [])).toEqual({ lane: 'standing' });
    expect(laneFor('thread', at({ id: 'p', kind: 'post' }), [])).toEqual({ lane: 'standing' });
    expect(laneFor(undefined, ask, [ask])).toEqual({ lane: 'standing' });
  });
});

describe('decide on a self-addressed entry (HIVE-186)', () => {
  const self: LedgerEntry = { id: 's', ts: 0, from: 'shipper', to: 'shipper', kind: 'ask', body: 'hand over' };

  it('ignores it on the lane that wrote it, as before', () => {
    expect(decide('sleeping', self)).toBe('ignore');
    expect(decide('sleeping', self, { sameLane: true })).toBe('ignore');
  });

  it('wakes a different lane with it', () => {
    expect(decide('sleeping', self, { sameLane: false })).toBe('wake');
    expect(decide('working', self, { sameLane: false })).toBe('queue');
  });
});

describe('laneClaims (HIVE-186)', () => {
  const e = (over: Partial<LedgerEntry>): LedgerEntry => ({ id: 'x', ts: 0, from: 'shipper', kind: 'claim', body: 'b', ...over });
  const begun = (run: string, lane: string) =>
    e({ id: `s-${run}`, kind: 'event', body: 'run.started — ledger', meta: { run, lane } });

  it('is the lanes of the agent\'s open claims, by the run that claimed', () => {
    const log = [
      begun('r1', 'repo:a/x'), begun('r2', 'repo:b/y'),
      e({ id: 'c1', meta: { task: 'a/x#1', run: 'r1' } }),
      e({ id: 'c2', meta: { task: 'b/y#2', run: 'r2' } }),
      e({ id: 'r', kind: 'release', meta: { task: 'b/y#2', run: 'r2' } }),
      e({ id: 'c3', from: 'builder', meta: { task: 'z#9', run: 'r1' } }),
    ];
    expect(laneClaims('shipper', log)).toEqual(new Map([['repo:a/x', 1]]));
  });

  it('counts two claims on one lane (HIVE-408)', () => {
    const log = [
      begun('r1', 'repo:a/x'),
      e({ id: 'c1', meta: { task: 'a/x#1', run: 'r1' } }),
      e({ id: 'c2', meta: { task: 'a/x#2', run: 'r1' } }),
    ];
    expect(laneClaims('shipper', log).get('repo:a/x')).toBe(2);
  });
});

describe('acceptedLanes (HIVE-410)', () => {
  const e = (over: Partial<LedgerEntry>): LedgerEntry => ({ id: 'x', ts: 0, from: 'shipper', kind: 'post', body: 'b', ...over });

  it("counts the open asks an agent accepted, by the accepting run's lane", () => {
    const log = [
      e({ id: 'k1', from: 'sess-1', to: 'shipper', kind: 'ask' }),
      e({ id: 'k2', from: 'sess-1', to: 'shipper', kind: 'ask' }),
      e({ id: 'k3', from: 'sess-1', to: 'builder', kind: 'ask' }),
      e({ id: 's1', kind: 'event', body: 'run.started — ledger', meta: { run: 'r1', lane: 'repo:a/x', wakes: ['k1', 'k2'] } }),
      e({ id: 'p1', to: 'sess-1', thread: 'k1', meta: { accepted: true, run: 'r1' } }),
      e({ id: 'p2', to: 'sess-1', thread: 'k2', meta: { accepted: true, run: 'r1' } }),
      e({ id: 'n2', to: 'sess-1', kind: 'answer', thread: 'k2' }),
    ];

    expect(acceptedLanes('shipper', log, 1_000)).toEqual(new Map([['repo:a/x', 1]]));
    expect(acceptedLanes('builder', log, 1_000)).toEqual(new Map());
  });
});

describe('askRefusal (HIVE-412)', () => {
  it('lets any party start work when the agent names no asks_from', () => {
    expect(askRefusal(AGENT, undefined, entry({ from: 'acr' }), [])).toBeUndefined();
  });

  it('refuses a new ask from a party the list does not name, naming who may ask', () => {
    expect(askRefusal(AGENT, ['sess-*', 'builder'], entry({ from: 'acr' }), [])).toBe(
      'pr-reviewer does not take asks from acr; it takes them from sess-*, builder and overmind.',
    );
  });

  it('admits a listed party, and any session under sess-*', () => {
    expect(askRefusal(AGENT, ['sess-*', 'builder'], entry({ from: 'builder' }), [])).toBeUndefined();
    expect(askRefusal(AGENT, ['sess-*'], entry({ from: 'sess-3f2' }), [])).toBeUndefined();
    expect(askRefusal(AGENT, ['builder'], entry({ from: 'sess-3f2' }), [])).toBeDefined();
  });

  it('always admits the overmind and the agent itself', () => {
    expect(askRefusal(AGENT, [], entry({ from: 'overmind' }), [])).toBeUndefined();
    expect(askRefusal(AGENT, [], entry({ from: AGENT }), [])).toBeUndefined();
  });

  it('never filters an answer or a post', () => {
    expect(askRefusal(AGENT, [], entry({ from: 'acr', kind: 'answer', thread: 'k1' }), [])).toBeUndefined();
    expect(askRefusal(AGENT, [], entry({ from: 'acr', kind: 'post' }), [])).toBeUndefined();
  });

  it('admits a threaded ask on a thread the agent or the overmind opened', () => {
    const mine = entry({ id: 'k1', from: AGENT, to: 'acr', kind: 'ask' });
    const overminds = entry({ id: 'k4', from: 'overmind', to: 'builder', kind: 'ask' });

    expect(askRefusal(AGENT, [], entry({ from: 'acr', thread: 'k1' }), [mine, overminds])).toBeUndefined();
    expect(askRefusal(AGENT, [], entry({ from: 'acr', thread: 'k4' }), [mine, overminds])).toBeUndefined();
  });

  it('admits a threaded ask on a thread opened to the agent by a party the list admits', () => {
    const toMe = entry({ id: 'k2', from: 'sess-1', to: AGENT, kind: 'ask' });

    expect(askRefusal(AGENT, ['sess-*'], entry({ from: 'acr', thread: 'k2' }), [toMe])).toBeUndefined();
  });

  it('filters a threaded ask on a thread its unlisted sender opened to the agent itself', () => {
    const selfRooted = entry({ id: 'k5', from: 'acr', to: AGENT, kind: 'ask' });

    expect(askRefusal(AGENT, ['sess-*'], entry({ from: 'acr', thread: 'k5' }), [selfRooted])).toBe(
      'pr-reviewer does not take asks from acr; it takes them from sess-* and overmind.',
    );
  });

  it('filters a threaded ask on a thread the agent is not a party to, or one the log does not hold', () => {
    const theirs = entry({ id: 'k3', from: 'sess-1', to: 'builder', kind: 'ask' });
    const refusal = 'pr-reviewer does not take asks from acr; it takes them from overmind.';

    expect(askRefusal(AGENT, [], entry({ from: 'acr', thread: 'k3' }), [theirs])).toBe(refusal);
    expect(askRefusal(AGENT, [], entry({ from: 'acr', thread: 'gone' }), [theirs])).toBe(refusal);
  });

  it('names only the overmind when the list is empty', () => {
    expect(askRefusal(AGENT, [], entry({ from: 'acr' }), [])).toBe(
      'pr-reviewer does not take asks from acr; it takes them from overmind.',
    );
  });
});
