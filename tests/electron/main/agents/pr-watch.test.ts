// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createPrWatch, heldPrs, prChanges, type PrFacet } from '../../../../electron/main/agents/pr-watch';
import type { PrRecord, PrsSnapshot } from '../../../../electron/shared/github-contract';
import type { LedgerEntry, LedgerPostRequest, LedgerResult } from '../../../../electron/shared/ledger-contract';
import { prRecord } from '../../../support/prs';

const NOW = Date.parse('2026-11-13T12:00:00Z');

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'e', ts: NOW - 60_000, from: 'overmind', to: 'shipper', kind: 'post', body: 'b', ...over,
});
const claim = (task: string, from = 'shipper'): LedgerEntry =>
  entry({ id: `c-${task}`, from, to: undefined, kind: 'claim', body: `claimed ${task}`, meta: { task } });
const ask = (id: string, meta: Record<string, unknown>): LedgerEntry =>
  entry({ id, from: 'sess-a', kind: 'ask', body: 'ship it', meta });
const accept = (thread: string, from = 'shipper'): LedgerEntry =>
  entry({ id: `acc-${thread}`, from, to: 'sess-a', kind: 'post', thread, body: 'taken', ts: NOW - 30_000, meta: { accepted: true } });

const snapshot = (...prs: PrRecord[]): PrsSnapshot => ({ prs, repos: 1 });
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const pr7 = (over: Partial<PrRecord> = {}): PrRecord =>
  prRecord({ owner: 'Acme', repo: 'Hive', number: 7, checks: 'running', head: SHA_A, ...over });
const facetOf = ({ state, checks, reviewDecision, findings, head, mergeable }: PrRecord): PrFacet =>
  ({ state, checks, reviewDecision, findings, head, mergeable });

describe('heldPrs (HIVE-412)', () => {
  it('reads the agent’s open PR claims, lower-cased, and nothing it released or someone else holds', () => {
    const released = entry({ id: 'r', from: 'shipper', to: undefined, kind: 'release', body: '', meta: { task: 'b/y#2' } });
    const log = [claim('Acme/Hive#7'), claim('b/y#2'), released, claim('c/z#3', 'fixer'), claim('acme/hive#7 findings')];
    expect(heldPrs('shipper', log, NOW)).toEqual(new Set(['acme/hive#7']));
  });

  it('adds an accepted ask with a valid meta.repo and a numeric meta.pr', () => {
    const log = [
      ask('k1', { repo: 'Acme/Hive', pr: 9 }), accept('k1'),
      ask('k2', { repo: 'acme/hive', pr: 10 }),
      ask('k3', { repo: 'acme/hive', pr: '11' }), accept('k3'),
      ask('k4', { repo: 'no-slash', pr: 12 }), accept('k4'),
      ask('k5', { repo: 'acme/hive', pr: 13 }), accept('k5', 'sess-b'),
    ];
    expect(heldPrs('shipper', log, NOW)).toEqual(new Set(['acme/hive#9']));
  });
});

describe('prChanges (HIVE-412)', () => {
  const held = new Set(['acme/hive#7']);

  it('treats a first sight as a baseline and an unmoved PR as no change', () => {
    expect(prChanges(new Map(), snapshot(pr7()), held)).toEqual([]);
    expect(prChanges(new Map([['acme/hive#7', facetOf(pr7())]]), snapshot(pr7()), held)).toEqual([]);
  });

  it.each([
    ['state', { state: 'approved' as const }, 'state open → approved'],
    ['checks', { checks: 'passing' as const }, 'checks running → passing'],
    ['reviewDecision', { reviewDecision: 'APPROVED' as const }, 'reviewDecision none → APPROVED'],
    ['findings', { findings: 0 }, 'findings 2 → 0'],
    ['head', { head: SHA_B }, `head ${SHA_A} → ${SHA_B}`],
    ['mergeable', { mergeable: 'CONFLICTING' as const }, 'mergeable MERGEABLE → CONFLICTING'],
  ])('reports a move in %s', (facet, over, move) => {
    const before = new Map([['acme/hive#7', facetOf(pr7({ mergeable: 'MERGEABLE' }))]]);
    expect(prChanges(before, snapshot(pr7({ mergeable: 'MERGEABLE', ...over })), held)).toEqual([
      { repo: 'Acme/Hive', pr: 7, changed: [facet], line: `Acme/Hive#7 changed: ${move}` },
    ]);
  });

  it('treats an UNKNOWN mergeable as no information, either way', () => {
    const known = new Map([['acme/hive#7', facetOf(pr7({ mergeable: 'MERGEABLE' }))]]);
    expect(prChanges(known, snapshot(pr7({ mergeable: 'UNKNOWN' })), held)).toEqual([]);
    const unknown = new Map([['acme/hive#7', facetOf(pr7({ mergeable: 'UNKNOWN' }))]]);
    expect(prChanges(unknown, snapshot(pr7({ mergeable: 'MERGEABLE' })), held)).toEqual([]);
  });

  it('names every facet that moved in one line, and ignores a PR nobody holds', () => {
    const before = new Map([['acme/hive#7', facetOf(pr7())], ['acme/hive#8', facetOf(pr7({ number: 8 }))]]);
    const after = snapshot(pr7({ checks: 'failing', findings: 3 }), pr7({ number: 8, checks: 'failing' }));
    expect(prChanges(before, after, held)).toEqual([
      { repo: 'Acme/Hive', pr: 7, changed: ['checks', 'findings'], line: 'Acme/Hive#7 changed: checks running → failing, findings 2 → 3' },
    ]);
  });

  it('says nothing about a held PR missing from the sweep', () => {
    expect(prChanges(new Map([['acme/hive#7', facetOf(pr7())]]), snapshot(), held)).toEqual([]);
  });
});

describe('createPrWatch (HIVE-412)', () => {
  const setup = (log: LedgerEntry[], { shipper = true, ok = true } = {}) => {
    const posts: LedgerPostRequest[] = [];
    const prs = vi.fn(() => Promise.resolve({ ok: true as const, value: snapshot() }));
    const append = (request: LedgerPostRequest): LedgerResult => {
      posts.push(request);
      return ok ? { ok: true, id: `p${String(posts.length)}` } : { ok: false, status: 500, reason: 'disk full' };
    };
    const watch = createPrWatch({
      github: { prs },
      ledger: { read: () => ({ entries: log }), append },
      now: () => NOW,
      isAgent: (id) => shipper && id === 'shipper',
    });
    return { watch, posts, prs };
  };

  it('posts one overmind post per change to the shipper, with repo, pr and changed', () => {
    const { watch, posts } = setup([claim('acme/hive#7')]);

    watch.observe(snapshot(pr7()));
    expect(posts).toEqual([]);

    watch.observe(snapshot(pr7({ checks: 'passing' })));
    expect(posts).toEqual([{
      from: 'overmind', to: 'shipper', kind: 'post',
      body: 'Acme/Hive#7 changed: checks running → passing',
      meta: { repo: 'Acme/Hive', pr: 7, changed: ['checks'] },
    }]);

    watch.observe(snapshot());
    watch.observe(snapshot(pr7({ checks: 'passing' })));
    expect(posts).toHaveLength(1);
  });

  it('starts a PR from a fresh baseline once it is held again', () => {
    const log = [claim('acme/hive#7')];
    const { watch, posts } = setup(log);
    watch.observe(snapshot(pr7()));
    log.push(entry({ id: 'r', from: 'shipper', to: undefined, kind: 'release', body: '', meta: { task: 'acme/hive#7' } }));
    watch.observe(snapshot(pr7({ checks: 'failing' })));
    log.push({ ...claim('acme/hive#7'), id: 'c2' });
    watch.observe(snapshot(pr7({ checks: 'passing' })));
    expect(posts).toEqual([]);
  });

  it('does not repeat a change whose post failed, and says why on the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { watch, posts } = setup([claim('acme/hive#7')], { ok: false });
    watch.observe(snapshot(pr7()));
    watch.observe(snapshot(pr7({ checks: 'passing' })));
    watch.observe(snapshot(pr7({ checks: 'passing' })));
    expect(posts).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    warn.mockRestore();
  });

  it('keeps the last known mergeable through an UNKNOWN, so the next real answer is diffed against it', () => {
    const { watch, posts } = setup([claim('acme/hive#7')]);
    watch.observe(snapshot(pr7({ mergeable: 'MERGEABLE' })));
    watch.observe(snapshot(pr7({ mergeable: 'UNKNOWN' })));
    watch.observe(snapshot(pr7({ mergeable: 'CONFLICTING' })));
    expect(posts.map((post) => post.body)).toEqual(['Acme/Hive#7 changed: mergeable MERGEABLE → CONFLICTING']);
  });

  it('posts nothing without a shipper', () => {
    const { watch, posts } = setup([claim('acme/hive#7')], { shipper: false });
    watch.observe(snapshot(pr7()));
    watch.observe(snapshot(pr7({ checks: 'passing' })));
    expect(posts).toEqual([]);
  });

  it('sweeps on a tick only while the shipper holds a PR', () => {
    const idle = setup([]);
    idle.watch.tick();
    expect(idle.prs).not.toHaveBeenCalled();

    const alone = setup([claim('acme/hive#7')], { shipper: false });
    alone.watch.tick();
    expect(alone.prs).not.toHaveBeenCalled();

    const busy = setup([claim('acme/hive#7')]);
    busy.watch.tick();
    expect(busy.prs).toHaveBeenCalledTimes(1);
  });

  it('swallows a sweep that rejects', async () => {
    const { watch, prs } = setup([claim('acme/hive#7')]);
    prs.mockImplementationOnce(() => Promise.reject(new Error('spawn gh EACCES')));
    watch.tick();
    await Promise.resolve();
    expect(prs).toHaveBeenCalledTimes(1);
  });
});
