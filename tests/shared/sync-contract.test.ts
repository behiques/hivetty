import { describe, expect, it } from 'vitest';

import {
  parseSetSyncGroupRequest,
  parseSyncedAppearance,
  SYNC_GROUP_LABELS,
  SYNC_GROUPS,
  SYNCED_APPEARANCE_FIELDS,
} from '@shared/sync-contract';

/** The settings sync contract both processes share (HIVE-284). */

describe('parseSetSyncGroupRequest', () => {
  it('accepts a known group and a boolean', () => {
    expect(parseSetSyncGroupRequest({ group: 'automation', on: false })).toEqual({ group: 'automation', on: false });
  });

  it.each([
    ['an unknown group', { group: 'projects', on: true }],
    ['a non-boolean on', { group: 'automation', on: 'yes' }],
    ['an extra key', { group: 'automation', on: true, path: '/etc' }],
    ['a missing key', { group: 'automation' }],
    ['null', null],
    ['a string', 'automation'],
  ])('throws on %s', (_, input) => {
    expect(() => parseSetSyncGroupRequest(input)).toThrow(TypeError);
  });
});

describe('parseSyncedAppearance', () => {
  it('keeps only the listed fields', () => {
    expect(parseSyncedAppearance({ theme: 'dark', listPanelWidth: 300, density: 'compact' })).toEqual({
      theme: 'dark',
      density: 'compact',
    });
  });

  it('answers an empty object for a non-object', () => {
    expect(parseSyncedAppearance(null)).toEqual({});
    expect(parseSyncedAppearance('dark')).toEqual({});
  });

  it('never lists a panel width or a split ratio', () => {
    expect(SYNCED_APPEARANCE_FIELDS.some((field) => /panel|ratio|split/i.test(field))).toBe(false);
  });
});

describe('the groups', () => {
  it('labels the third group as decided', () => {
    expect(SYNC_GROUPS).toEqual(['harnesses', 'automation', 'workspace']);
    expect(SYNC_GROUP_LABELS.workspace).toBe('Appearance & preferences');
  });
});
