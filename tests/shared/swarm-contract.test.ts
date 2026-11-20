// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  BUNDLED_VERSION,
  compareVersions,
  isBundled,
  isSwarmFolder,
  isSwarmId,
  isSwarmRepoUrl,
  parseSwarmEntry,
  parseSwarmManifest,
  parseSwarmAutoUpdateRequest,
  parseSwarmRequest,
  parseSwarmTag,
  swarmTag,
  versionLabel,
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
    // The folder becomes a path in an install, so it is slug segments only.
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

describe('isBundled and versionLabel', () => {
  it('names the bundled version by name, not by comparison', () => {
    expect(BUNDLED_VERSION).toBe('bundled');
    expect(isBundled('bundled')).toBe(true);
    expect(isBundled('1.0.0')).toBe(false);
  });

  it('labels the bundled version "Bundled" and every other one with a v', () => {
    expect(versionLabel('bundled')).toBe('Bundled');
    expect(versionLabel('1.0.1')).toBe('v1.0.1');
  });
});

describe('isSwarmId', () => {
  it.each(['cmabc123', 'a-b_C9'])('accepts %j', (value) => {
    expect(isSwarmId(value)).toBe(true);
  });

  it.each<unknown>(['', '..', 'a/b', 'a.b', 'a'.repeat(65), 42])('rejects %j', (value) => {
    expect(isSwarmId(value)).toBe(false);
  });
});

describe('isSwarmFolder', () => {
  it.each(['', 'standard', 'team/standard'])('accepts %j', (value) => {
    expect(isSwarmFolder(value)).toBe(true);
  });

  it.each<unknown>(['..', '/a', 'a//b', 'a/', 'A'])('rejects %j', (value) => {
    expect(isSwarmFolder(value)).toBe(false);
  });
});

describe('isSwarmRepoUrl', () => {
  it.each([
    'https://github.com/behiques/hivetty-swarms.git',
    'ssh://git@github.com/acme/tools.git',
    'git@github.com:acme/tools.git',
  ])('accepts %j', (value) => {
    expect(isSwarmRepoUrl(value)).toBe(true);
  });

  it.each<unknown>([
    'ext::sh -c id',
    'file:///tmp/x',
    '/tmp/x',
    'http://github.com/a/b',
    '--upload-pack=x',
    '-x@host:path',
    'https://-evil/x',
    'ssh://git@-oProxyCommand=x/y',
    'https://github.com/a b',
    'https://github.com/a/b?x=1',
    `https://github.com/${'a'.repeat(494)}`,
    42,
  ])('rejects %j', (value) => {
    expect(isSwarmRepoUrl(value)).toBe(false);
  });

  it('measures the over-long case at 513 characters', () => {
    expect(`https://github.com/${'a'.repeat(494)}`).toHaveLength(513);
    expect(isSwarmRepoUrl(`https://github.com/${'a'.repeat(493)}`)).toBe(true);
  });
});

const nativeRow = {
  id: 'cmabc123',
  slug: 'standard',
  kind: 'native',
  title: 'Standard',
  description: 'Ticket to merge.',
  publisher: 'HiveTTY',
  tags: ['workflow'],
  version: '1.0.0',
  updatedAt: '2026-11-19T00:00:00.000Z',
  installs: 3,
  agents: [{ name: 'builder', description: 'Builds.', tools: ['Bash'] }],
  skills: [{ name: 'tdd', description: 'Test first.' }],
  repoUrl: 'https://github.com/behiques/hivetty-swarms.git',
  folder: 'standard',
  commit: 'a'.repeat(40),
  access: 'token',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
};

describe('parseSwarmEntry', () => {
  it('round-trips a full native row', () => {
    expect(parseSwarmEntry(nativeRow)).toEqual(nativeRow);
  });

  it('parses an organization row with no version, no commit and nothing listed', () => {
    const row = {
      ...nativeRow,
      kind: 'organization',
      version: null,
      commit: null,
      agents: [],
      skills: [],
      repoUrl: 'git@github.com:acme/tools.git',
      folder: '',
      access: 'user',
      policy: 'pinned',
      pinnedVersion: '2.1.0',
      org: { id: 'org1', name: 'Acme' },
    };
    expect(parseSwarmEntry(row)).toEqual(row);
  });

  it('drops an unknown key', () => {
    expect(parseSwarmEntry({ ...nativeRow, extra: 'x' })).toEqual(nativeRow);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a bad id', { id: '../x' }],
    ['a bad slug', { slug: 'Standard' }],
    ['kind Native', { kind: 'Native' }],
    ['a non-string title', { title: 1 }],
    ['a non-string description', { description: null }],
    ['a non-string publisher', { publisher: 2 }],
    ['tags not an array of strings', { tags: ['a', 1] }],
    ['tags not an array', { tags: 'a' }],
    ['version 1.0', { version: '1.0' }],
    ['a non-string updatedAt', { updatedAt: 5 }],
    ['commit of 39 hex', { commit: 'a'.repeat(39) }],
    ['folder ../x', { folder: '../x' }],
    ['repoUrl ext::sh', { repoUrl: 'ext::sh' }],
    ['access key', { access: 'key' }],
    ['policy newest', { policy: 'newest' }],
    ['pinnedVersion x', { pinnedVersion: 'x' }],
    ['org with a numeric id', { org: { id: 1 } }],
    ['an agent without tools', { agents: [{ name: 'a', description: 'b' }] }],
    ['an agent with a non-string tool', { agents: [{ name: 'a', description: 'b', tools: [1] }] }],
    ['agents not an array', { agents: {} }],
    ['a skill without description', { skills: [{ name: 'tdd' }] }],
    ['skills not an array', { skills: null }],
    ['installs as a string', { installs: '3' }],
  ])('returns null for %s', (_label, patch) => {
    expect(parseSwarmEntry({ ...nativeRow, ...patch })).toBeNull();
  });

  it.each<unknown>([null, 'row', [], 42])('returns null for the non-object row %j', (row) => {
    expect(parseSwarmEntry(row)).toBeNull();
  });
});

describe('parseSwarmRequest', () => {
  it('returns the id', () => {
    expect(parseSwarmRequest({ swarmId: 'cmabc' })).toEqual({ swarmId: 'cmabc' });
  });

  it.each<unknown>([{}, null, { swarmId: '../x' }])('throws for %j', (payload) => {
    expect(() => parseSwarmRequest(payload)).toThrow('swarmId is not a swarm id');
  });
});

describe('parseSwarmAutoUpdateRequest', () => {
  it('returns the id and the flag', () => {
    expect(parseSwarmAutoUpdateRequest({ swarmId: 'a1', autoUpdate: false })).toEqual({ swarmId: 'a1', autoUpdate: false });
  });

  it('drops any other key', () => {
    expect(parseSwarmAutoUpdateRequest({ swarmId: 'a1', autoUpdate: true, repoUrl: 'https://evil' })).toEqual({
      swarmId: 'a1',
      autoUpdate: true,
    });
  });

  it.each<unknown>([
    null,
    {},
    { swarmId: '../x', autoUpdate: true },
    { swarmId: 'a1' },
    { swarmId: 'a1', autoUpdate: 'true' },
    { swarmId: 'a1', autoUpdate: 1 },
  ])('throws for %j', (payload) => {
    expect(() => parseSwarmAutoUpdateRequest(payload)).toThrow();
  });
});
