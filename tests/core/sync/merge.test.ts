// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { merge, type Item } from '../../../core/sync/merge';

/**
 * The three-way merge settings sync runs per key and per file (HIVE-284): every row of the spec's merge table,
 * the first-join rows, and delete against edit.
 */

const item = (hash: string, at = 1): Item => ({ hash, at, data: hash });
const id = 'automation:f:skills/review/SKILL.md';

describe('merge', () => {
  it('does nothing when neither side changed, or both made the same change', () => {
    expect(merge({ [id]: 'a' }, { [id]: item('a') }, { [id]: item('a') }, false)).toEqual({
      merged: { [id]: item('a') },
      set: {},
      remove: [],
      conflicts: {},
      push: false,
    });
    expect(merge({ [id]: 'a' }, { [id]: item('b') }, { [id]: item('b') }, false)).toMatchObject({
      set: {},
      remove: [],
      conflicts: {},
      push: false,
    });
  });

  it('keeps a local change and pushes it', () => {
    expect(merge({ [id]: 'a' }, { [id]: item('b') }, { [id]: item('a') }, false)).toEqual({
      merged: { [id]: item('b') },
      set: {},
      remove: [],
      conflicts: {},
      push: true,
    });
  });

  it('applies a remote change', () => {
    expect(merge({ [id]: 'a' }, { [id]: item('a') }, { [id]: item('b') }, false)).toEqual({
      merged: { [id]: item('b') },
      set: { [id]: item('b') },
      remove: [],
      conflicts: {},
      push: false,
    });
  });

  it('lets the newer side win when both changed, and keeps the loser', () => {
    expect(merge({ [id]: 'a' }, { [id]: item('b', 5) }, { [id]: item('c', 9) }, false)).toEqual({
      merged: { [id]: item('c', 9) },
      set: { [id]: item('c', 9) },
      remove: [],
      conflicts: { [id]: item('b', 5) },
      push: false,
    });
    expect(merge({ [id]: 'a' }, { [id]: item('b', 9) }, { [id]: item('c', 5) }, false)).toEqual({
      merged: { [id]: item('b', 9) },
      set: {},
      remove: [],
      conflicts: { [id]: item('c', 5) },
      push: true,
    });
  });

  it('gives a tie to the remote', () => {
    expect(merge({ [id]: 'a' }, { [id]: item('b', 5) }, { [id]: item('c', 5) }, false).merged[id]).toEqual(item('c', 5));
  });

  it('propagates a delete either way when the other side is unchanged', () => {
    expect(merge({ [id]: 'a' }, {}, { [id]: item('a') }, false)).toEqual({
      merged: {},
      set: {},
      remove: [],
      conflicts: {},
      push: true,
    });
    expect(merge({ [id]: 'a' }, { [id]: item('a') }, {}, false)).toEqual({
      merged: {},
      set: {},
      remove: [id],
      conflicts: {},
      push: false,
    });
    expect(merge({ [id]: 'a' }, {}, {}, false)).toEqual({ merged: {}, set: {}, remove: [], conflicts: {}, push: false });
  });

  it('lets an edit beat a delete, with nothing copied', () => {
    expect(merge({ [id]: 'a' }, {}, { [id]: item('b') }, false)).toEqual({
      merged: { [id]: item('b') },
      set: { [id]: item('b') },
      remove: [],
      conflicts: {},
      push: false,
    });
    expect(merge({ [id]: 'a' }, { [id]: item('b') }, {}, false)).toEqual({
      merged: { [id]: item('b') },
      set: {},
      remove: [],
      conflicts: {},
      push: true,
    });
  });

  it('on a first join keeps what only one side has', () => {
    const mine = 'automation:f:skills/mine/SKILL.md';
    const theirs = 'automation:f:skills/theirs/SKILL.md';
    const result = merge({}, { [mine]: item('m') }, { [theirs]: item('t') }, true);
    expect(result.merged).toEqual({ [mine]: item('m'), [theirs]: item('t') });
    expect(result.set).toEqual({ [theirs]: item('t') });
    expect(result.push).toBe(true);
    expect(result.conflicts).toEqual({});
  });

  it('on a first join lets the synced copy win even when this Mac is newer, and keeps this Mac’s copy', () => {
    expect(merge({}, { [id]: item('b', 9) }, { [id]: item('c', 5) }, true)).toEqual({
      merged: { [id]: item('c', 5) },
      set: { [id]: item('c', 5) },
      remove: [],
      conflicts: { [id]: item('b', 9) },
      push: false,
    });
  });

  it('treats ids independently', () => {
    const other = 'harnesses:k:claudeCommand';
    const result = merge(
      { [id]: 'a', [other]: 'x' },
      { [id]: item('b'), [other]: item('x') },
      { [id]: item('a'), [other]: item('y') },
      false,
    );
    expect(result.merged).toEqual({ [id]: item('b'), [other]: item('y') });
    expect(result.set).toEqual({ [other]: item('y') });
    expect(result.push).toBe(true);
  });
});
