// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  CARD_AFTER_MS,
  RENUDGE_AFTER_MS,
  watchSteps,
  type WatchFacts,
} from '../../../../electron/main/ledger/watchdog';
import type { LedgerEntry } from '../../../../electron/shared/ledger-contract';

let seq = 0;
/** Ids sort in write order, as the real log's do. */
const e = (over: Partial<LedgerEntry> & Pick<LedgerEntry, 'ts' | 'from' | 'kind'>): LedgerEntry => ({
  id: `20261113-000000-${String(++seq).padStart(4, '0')}`,
  body: '',
  ...over,
});

const facts = (over: Partial<WatchFacts> = {}): WatchFacts => ({
  isAgent: (id) => ['builder', 'shipper', 'reviewer'].includes(id),
  quietMs: () => 30 * 60_000,
  laneLive: () => false,
  liveRuns: () => [],
  ...over,
});

const T0 = 1_000_000;

/** An ask from the builder to a session, nudged at `T0 + 1000`, never served. */
const sessionAsk = () => {
  const ask = e({ ts: T0, from: 'builder', to: 'sess-1', kind: 'ask', ref: 'a40', body: 'which base?' });
  const receipt = e({ ts: T0 + 1000, from: 'overmind', to: 'sess-1', kind: 'event', body: 'nudge written (a40)', meta: { delivered: ask.id } });
  return { ask, receipt };
};

describe('watchSteps: renudge (HIVE-411)', () => {
  it('re-nudges a session ask a minute after its receipt with no served event', () => {
    const { ask, receipt } = sessionAsk();
    expect(watchSteps([ask, receipt], T0 + 1000 + RENUDGE_AFTER_MS - 1, facts())).toEqual([]);
    expect(watchSteps([ask, receipt], T0 + 1000 + RENUDGE_AFTER_MS, facts())).toEqual([
      { step: 'renudge', ask, to: 'sess-1' },
    ]);
  });

  it('does not re-nudge once the context was served', () => {
    const { ask, receipt } = sessionAsk();
    const served = e({ ts: T0 + 2000, from: 'overmind', to: 'sess-1', kind: 'event', body: 'served', meta: { served: ask.id } });
    expect(watchSteps([ask, receipt, served], T0 + 10 * RENUDGE_AFTER_MS, facts())).toEqual([]);
  });

  it('does not re-nudge an ask with no receipt, or an ask to an agent', () => {
    const { ask } = sessionAsk();
    const toAgent = e({ ts: T0, from: 'sess-1', to: 'builder', kind: 'ask', ref: 'a41', body: 'build' });
    const agentReceipt = e({ ts: T0 + 1, from: 'overmind', to: 'builder', kind: 'event', body: 'x', meta: { delivered: toAgent.id } });
    expect(watchSteps([ask, toAgent, agentReceipt], T0 + 10 * RENUDGE_AFTER_MS, facts())).toEqual([]);
  });

  it('fires once: its marker in the log (a restart reads the same log) stops it', () => {
    const { ask, receipt } = sessionAsk();
    const mark = e({ ts: T0 + 1000 + RENUDGE_AFTER_MS, from: 'overmind', to: 'sess-1', kind: 'event', thread: ask.id, body: 're-nudge', meta: { watch: 'renudge', watched: ask.id } });
    expect(watchSteps([ask, receipt, mark], T0 + 1000 + RENUDGE_AFTER_MS + 1, facts())).toEqual([]);
  });

  it('ignores a marker another party wrote', () => {
    const { ask, receipt } = sessionAsk();
    const forged = e({ ts: T0 + 1500, from: 'sess-1', kind: 'post', thread: ask.id, body: 'x', meta: { watch: 'renudge', watched: ask.id } });
    expect(watchSteps([ask, receipt, forged], T0 + 1000 + RENUDGE_AFTER_MS, facts())).toHaveLength(1);
  });
});

describe('watchSteps: card (HIVE-411)', () => {
  const renudged = () => {
    const { ask, receipt } = sessionAsk();
    const mark = e({ ts: T0 + 61_000, from: 'overmind', to: 'sess-1', kind: 'event', thread: ask.id, body: 're-nudge', meta: { watch: 'renudge', watched: ask.id } });
    return { ask, log: [ask, receipt, mark], markTs: mark.ts };
  };

  it('raises a card 15 minutes after the re-nudge, not before', () => {
    const { ask, log, markTs } = renudged();
    expect(watchSteps(log, markTs + CARD_AFTER_MS - 1, facts())).toEqual([]);
    expect(watchSteps(log, markTs + CARD_AFTER_MS, facts())).toEqual([{ step: 'card', ask, to: 'overmind' }]);
  });

  it('raises it once', () => {
    const { ask, log, markTs } = renudged();
    const card = e({ ts: markTs + CARD_AFTER_MS, from: 'overmind', to: 'overmind', kind: 'ask', ref: 'a99', body: 'x', meta: { watch: 'card', watched: ask.id } });
    expect(watchSteps([...log, card], markTs + 2 * CARD_AFTER_MS, facts())).toEqual([]);
  });
});

describe('watchSteps: rewake (HIVE-411)', () => {
  /** sess-0a asked the shipper; the shipper accepted at T0 + 5000 on its repo lane. */
  const accepted = () => {
    const ask = e({ ts: T0, from: 'sess-0a', to: 'shipper', kind: 'ask', ref: 'a50', body: 'ship behiques/hivetty-cloud#40', meta: { repo: 'behiques/hivetty-cloud', pr: 40 } });
    const started = e({ ts: T0 + 1000, from: 'shipper', kind: 'event', body: 'run.started', meta: { run: 'r1', lane: 'repo:behiques/hivetty-cloud', wakes: [ask.id] } });
    const accept = e({ ts: T0 + 5000, from: 'shipper', to: 'sess-0a', kind: 'post', thread: ask.id, body: 'accepted', meta: { accepted: true, run: 'r1' } });
    return { ask, log: [ask, started, accept], acceptTs: accept.ts };
  };
  const quiet = 3 * 5 * 60_000; // a 5-minute repo lane, three intervals

  it('re-wakes the agent once its lane has been quiet for quietMs since the accept', () => {
    const { ask, log, acceptTs } = accepted();
    const f = facts({ quietMs: () => quiet });
    expect(watchSteps(log, acceptTs + quiet - 1, f)).toEqual([]);
    expect(watchSteps(log, acceptTs + quiet, f)).toEqual([{ step: 'rewake', ask, to: 'shipper' }]);
  });

  it('measures quiet from the agent’s newest entry on the thread', () => {
    const { ask, log, acceptTs } = accepted();
    const later = e({ ts: acceptTs + 60_000, from: 'shipper', to: 'sess-0a', kind: 'post', thread: ask.id, body: 'ci running' });
    const f = facts({ quietMs: () => quiet });
    expect(watchSteps([...log, later], acceptTs + quiet, f)).toEqual([]);
  });

  it('leaves a lane alone while a run holds it', () => {
    const { log, acceptTs } = accepted();
    const f = facts({ quietMs: () => quiet, laneLive: (agent, lane) => agent === 'shipper' && lane === 'repo:behiques/hivetty-cloud' });
    expect(watchSteps(log, acceptTs + 10 * quiet, f)).toEqual([]);
  });

  it('re-wakes once', () => {
    const { ask, log, acceptTs } = accepted();
    const mark = e({ ts: acceptTs + quiet, from: 'overmind', to: 'shipper', kind: 'post', thread: ask.id, body: 're-wake', meta: { watch: 'rewake', watched: ask.id } });
    expect(watchSteps([...log, mark], acceptTs + 10 * quiet, facts({ quietMs: () => quiet }))).toEqual([]);
  });
});
