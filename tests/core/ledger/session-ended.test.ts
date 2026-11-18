// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OVERMIND, type LedgerPostRequest, type LedgerResult } from '../../../shared/ledger-contract';
import { createLedger, type Ledger } from '../../../core/ledger/index';
import { releaseClaimsOf } from '../../../core/ledger/session-ended';

describe('releaseClaimsOf (HIVE-415)', () => {
  let dir: string;
  let ledger: Ledger;

  const releases = () => ledger.read({ kind: 'release' }).entries;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-session-ended-'));
    ledger = createLedger({ dir, knowsParty: () => true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('releases every claim the ended session holds, as the overmind', () => {
    ledger.append({ from: 'sess-a', kind: 'claim', body: 'claimed HIVE-1', meta: { task: 'HIVE-1' } });
    ledger.append({ from: 'sess-a', kind: 'claim', body: 'claimed HIVE-2', meta: { task: 'HIVE-2' } });

    releaseClaimsOf(ledger, 'sess-a');

    expect(releases().map(({ from, body, meta }) => ({ from, body, meta }))).toEqual([
      { from: OVERMIND, body: 'released HIVE-1: sess-a ended', meta: { task: 'HIVE-1', releasedFrom: 'sess-a' } },
      { from: OVERMIND, body: 'released HIVE-2: sess-a ended', meta: { task: 'HIVE-2', releasedFrom: 'sess-a' } },
    ]);
    expect(ledger.read({}).claims).toEqual({});
  });

  it('leaves a claim another party has since taken', () => {
    ledger.append({ from: 'sess-a', kind: 'claim', body: 'claimed HIVE-1', meta: { task: 'HIVE-1' } });
    ledger.append({ from: 'sess-b', kind: 'claim', body: 'claimed HIVE-1', meta: { task: 'HIVE-1' } });
    ledger.append({ from: 'sess-c', kind: 'claim', body: 'claimed HIVE-9', meta: { task: 'HIVE-9' } });

    releaseClaimsOf(ledger, 'sess-a');

    expect(releases()).toEqual([]);
    expect(ledger.read({}).claims).toEqual({ 'HIVE-1': 'sess-b', 'HIVE-9': 'sess-c' });
  });

  it('writes nothing for a session that holds no claim', () => {
    const append = vi.spyOn(ledger, 'append');

    releaseClaimsOf(ledger, 'sess-a');

    expect(append).not.toHaveBeenCalled();
  });

  it('writes once when the same session ends twice', () => {
    ledger.append({ from: 'sess-a', kind: 'claim', body: 'claimed HIVE-1', meta: { task: 'HIVE-1' } });

    releaseClaimsOf(ledger, 'sess-a');
    releaseClaimsOf(ledger, 'sess-a');

    expect(releases()).toHaveLength(1);
  });

  it('a failed release is logged and does not stop the next one; the next ending retries it', () => {
    ledger.append({ from: 'sess-a', kind: 'claim', body: 'claimed HIVE-1', meta: { task: 'HIVE-1' } });
    ledger.append({ from: 'sess-a', kind: 'claim', body: 'claimed HIVE-2', meta: { task: 'HIVE-2' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const real = ledger.append.bind(ledger);
    let failFirst = true;
    const flaky: Ledger = {
      ...ledger,
      append: (request: LedgerPostRequest): LedgerResult => {
        if (failFirst && request.kind === 'release') {
          failFirst = false;
          return { ok: false, status: 500, reason: 'disk full' };
        }
        return real(request);
      },
    };

    releaseClaimsOf(flaky, 'sess-a');

    expect(ledger.read({}).claims).toEqual({ 'HIVE-1': 'sess-a' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not release HIVE-1 after sess-a ended: disk full'));

    releaseClaimsOf(flaky, 'sess-a');

    expect(ledger.read({}).claims).toEqual({});
    warn.mockRestore();
  });

  it('a thrown read is logged, not raised: the redirect beside it still runs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: Ledger = {
      ...ledger,
      read: () => {
        throw new Error('log unreadable');
      },
    };

    expect(() => releaseClaimsOf(broken, 'sess-a')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read claims after sess-a ended'), expect.objectContaining({ message: 'log unreadable' }));
    warn.mockRestore();
  });
});
