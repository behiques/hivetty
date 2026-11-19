// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  parseSwarmManifest,
  parseSwarmTag,
  swarmTag,
} from '@shared/swarm-contract';

const valid = {
  name: 'standard',
  title: 'Standard',
  description: 'Ticket to merge: plan, build, review, ship.',
  publisher: 'HiveTTY',
  version: '1.0.0',
  tags: ['workflow', 'review'],
};

const without = (key: keyof typeof valid): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...valid };
  delete copy[key];
  return copy;
};

describe('parseSwarmManifest', () => {
  it.each<[string, unknown, string]>([
    ['null', null, ''],
    ['an array', [], ''],
    ['a string', 'x', ''],
    ['name missing', without('name'), 'name'],
    ['name uppercase', { ...valid, name: 'Standard' }, 'name'],
    ['name empty', { ...valid, name: '' }, 'name'],
    ['name 65 chars', { ...valid, name: 'a'.repeat(65) }, 'name'],
    ['title missing', without('title'), 'title'],
    ['title blank', { ...valid, title: '   ' }, 'title'],
    ['title 65 chars', { ...valid, title: 'T'.repeat(65) }, 'title'],
    ['description missing', without('description'), 'description'],
    ['description 281 chars', { ...valid, description: 'd'.repeat(281) }, 'description'],
    ['publisher missing', without('publisher'), 'publisher'],
    ['publisher 65 chars', { ...valid, publisher: 'p'.repeat(65) }, 'publisher'],
    ['version missing', without('version'), 'version'],
    ['version 1.0', { ...valid, version: '1.0' }, 'version'],
    ['version v1.0.0', { ...valid, version: 'v1.0.0' }, 'version'],
    ['version with a pre-release', { ...valid, version: '1.0.0-rc.1' }, 'version'],
    ['tags missing', without('tags'), 'tags'],
    ['9 tags', { ...valid, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }, 'tags'],
    ['a tag with a space', { ...valid, tags: ['Bad Tag'] }, 'tags'],
    ['a tag of 25 chars', { ...valid, tags: ['t'.repeat(25)] }, 'tags'],
    ['minApp 1.1', { ...valid, minApp: '1.1' }, 'minApp'],
  ])('refuses %s with one problem on that field', (_label, value, field) => {
    const result = parseSwarmManifest(value);

    expect(result.manifest).toBeNull();
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.field).toBe(field);
    expect(result.problems[0]?.reason).not.toBe('');
  });

  it('returns one problem per wrong field', () => {
    const result = parseSwarmManifest({ ...valid, name: 'X', version: '1' });

    expect(result.manifest).toBeNull();
    expect(result.problems.map((problem) => problem.field)).toEqual(['name', 'version']);
  });

  it('accepts the Standard manifest with no minApp', () => {
    expect(parseSwarmManifest(valid)).toEqual({ manifest: valid, problems: [] });
  });

  it('accepts a valid minApp', () => {
    expect(parseSwarmManifest({ ...valid, minApp: '1.1.0' })).toEqual({
      manifest: { ...valid, minApp: '1.1.0' },
      problems: [],
    });
  });

  it('ignores an unknown key and leaves it out', () => {
    const result = parseSwarmManifest({ ...valid, homepage: 'https://example.com' });

    expect(result.manifest).toEqual(valid);
    expect(result.problems).toEqual([]);
  });

  it('trims text fields', () => {
    expect(parseSwarmManifest({ ...valid, title: '  Standard  ' }).manifest?.title).toBe('Standard');
  });

  it('accepts an empty tag list', () => {
    expect(parseSwarmManifest({ ...valid, tags: [] }).manifest?.tags).toEqual([]);
  });
});

describe('parseSwarmTag and swarmTag', () => {
  it.each([
    ['v1.2.0', { folder: '', version: '1.2.0' }],
    ['standard/v1.2.0', { folder: 'standard', version: '1.2.0' }],
    ['team/standard/v1.2.0', { folder: 'team/standard', version: '1.2.0' }],
  ])('parses %s and round-trips it', (tag, parsed) => {
    expect(parseSwarmTag(tag)).toEqual(parsed);
    expect(swarmTag(parsed)).toBe(tag);
  });

  it.each([
    '1.2.0',
    'standard/1.2.0',
    'v1.2',
    '/v1.2.0',
    'standard/v1.2.0-rc.1',
    '',
    // The folder becomes a path in swarm:pull, so it is slug segments only.
    '../v1.0.0',
    '../../x/v1.0.0',
    'a//v1.0.0',
    '/a/v1.0.0',
    'a b/v1.0.0',
    'Standard/v1.0.0',
  ])(
    'refuses %j',
    (tag) => {
      expect(parseSwarmTag(tag)).toBeNull();
    },
  );
});

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('ignores a pre-release suffix', () => {
    expect(compareVersions('1.0.0-rc.12', '1.0.0')).toBe(0);
    expect(compareVersions('1.1.0', '1.0.0-rc.12')).toBeGreaterThan(0);
  });
});
