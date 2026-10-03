import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BRIDGE_ERROR } from '@lib/utils';
import { PR_DETAIL_CAP, useHiveStore } from '@stores/hive-store';

import { prRecord } from '../support/prs';

/** The Files tab's slices (HIVE-207). `lib/github` is mocked: what is under test is how each answer lands. */

const readPrDetail = vi.fn();
const readPrDiff = vi.fn();
const writePrThread = vi.fn();
const writePrViewed = vi.fn();

vi.mock('@lib/github', () => ({
  readPullRequests: () => Promise.resolve(null),
  searchPullRequests: () => Promise.resolve(null),
  readPrDetail: (request: unknown) => readPrDetail(request),
  postPrComment: () => Promise.resolve(null),
  readPrDiff: (request: unknown) => readPrDiff(request),
  writePrThread: (request: unknown) => writePrThread(request),
  writePrViewed: (request: unknown) => writePrViewed(request),
}));

const state = () => useHiveStore.getState();
const ok = <T,>(value: T) => ({ ok: true as const, value });
const refused = (message: string) => ({ ok: false as const, error: { kind: 'unknown' as const, message } });
const KEY = 'acme/nova-web#482';

beforeEach(() => {
  vi.clearAllMocks();
  state().reset();
});

describe('loadPrDiff (HIVE-207)', () => {
  it('is loading at the sha until the read lands, then ok with the text', async () => {
    let land!: (value: unknown) => void;
    readPrDiff.mockReturnValue(new Promise((done) => { land = done; }));
    const pending = state().loadPrDiff('acme', 'nova-web', 482, 'abc');
    expect(state().prDiffs[KEY]).toEqual({ key: KEY, sha: 'abc', state: 'loading' });
    expect(readPrDiff).toHaveBeenCalledWith({ owner: 'acme', repo: 'nova-web', n: 482 });
    land(ok('diff --git a/x b/x'));
    await pending;
    expect(state().prDiffs[KEY]).toEqual({ key: KEY, sha: 'abc', state: 'ok', text: 'diff --git a/x b/x' });
  });

  it('does not read again at the same sha, and reads again at a new one keeping the old text meanwhile', async () => {
    readPrDiff.mockResolvedValue(ok('one'));
    await state().loadPrDiff('acme', 'nova-web', 482, 'abc');
    await state().loadPrDiff('acme', 'nova-web', 482, 'abc');
    expect(readPrDiff).toHaveBeenCalledTimes(1);

    let land!: (value: unknown) => void;
    readPrDiff.mockReturnValue(new Promise((done) => { land = done; }));
    const pending = state().loadPrDiff('acme', 'nova-web', 482, 'def');
    expect(state().prDiffs[KEY]).toMatchObject({ sha: 'def', state: 'loading', text: 'one' });
    land(ok('two'));
    await pending;
    expect(state().prDiffs[KEY]).toMatchObject({ sha: 'def', state: 'ok', text: 'two' });
  });

  it('keeps the text beside the problem on a failure, and retries a failed read at the same sha', async () => {
    readPrDiff.mockResolvedValueOnce(ok('one')).mockResolvedValueOnce(refused('diff too large'));
    await state().loadPrDiff('acme', 'nova-web', 482, 'abc');
    await state().loadPrDiff('acme', 'nova-web', 482, 'def');
    expect(state().prDiffs[KEY]).toMatchObject({ state: 'failed', problem: 'diff too large', text: 'one' });
    readPrDiff.mockResolvedValueOnce(ok('two'));
    await state().loadPrDiff('acme', 'nova-web', 482, 'def');
    expect(state().prDiffs[KEY]).toMatchObject({ state: 'ok', text: 'two' });
  });

  it('says the bridge is missing with no bridge', async () => {
    readPrDiff.mockResolvedValue(null);
    await state().loadPrDiff('acme', 'nova-web', 482, 'abc');
    expect(state().prDiffs[KEY]).toMatchObject({ state: 'failed', problem: BRIDGE_ERROR });
  });

  it('drops an answer for an older sha', async () => {
    let first!: (value: unknown) => void;
    readPrDiff.mockReturnValueOnce(new Promise((done) => { first = done; })).mockResolvedValueOnce(ok('new'));
    const old = state().loadPrDiff('acme', 'nova-web', 482, 'abc');
    await state().loadPrDiff('acme', 'nova-web', 482, 'def');
    first(ok('old'));
    await old;
    expect(state().prDiffs[KEY]).toMatchObject({ sha: 'def', text: 'new' });
  });

  it('holds at most PR_DETAIL_CAP diffs, and reset clears them', async () => {
    readPrDiff.mockResolvedValue(ok('x'));
    for (let n = 1; n <= PR_DETAIL_CAP + 1; n += 1) await state().loadPrDiff('acme', 'nova-web', n, 'abc');
    expect(Object.keys(state().prDiffs)).toHaveLength(PR_DETAIL_CAP);
    expect(state().prDiffs['acme/nova-web#1']).toBeUndefined();
    state().reset();
    expect(state().prDiffs).toEqual({});
  });

  it('is dropped when its PR leaves the sweep, and kept on a quiet sweep', async () => {
    readPrDiff.mockResolvedValue(ok('x'));
    state().hydratePrs([prRecord({ number: 482 }), prRecord({ number: 483 })], 1);
    await state().loadPrDiff('acme', 'nova-web', 482, 'abc');
    await state().loadPrDiff('acme', 'nova-web', 483, 'abc');
    const before = state().prDiffs;
    state().hydratePrs([prRecord({ number: 482 }), prRecord({ number: 483 })], 1);
    expect(state().prDiffs).toBe(before);

    state().hydratePrs([prRecord({ number: 483 })], 1);
    expect(Object.keys(state().prDiffs)).toEqual(['acme/nova-web#483']);
  });
});
