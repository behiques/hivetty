// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { heldPrs } from '../../../../electron/main/agents/pr-watch';
import type { LedgerEntry } from '../../../../electron/shared/ledger-contract';

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
