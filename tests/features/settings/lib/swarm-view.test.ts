import { describe, expect, it } from 'vitest';

import {
  badgeOf,
  browseGroups,
  consentFingerprint,
  countsOf,
  diffContents,
  installVersionOf,
  installedRows,
  keptFiles,
  matches,
  needsConsent,
  publisherOf,
  rowState,
  stateText,
  type SwarmRowState,
} from '@/features/settings/lib/swarm-view';

import type { SwarmContents, SwarmFailure, SwarmListing, SwarmListItem } from '@shared/swarm-contract';

import { shippedStatus } from '../../../support/shipped';
import { installedSwarm, swarmEntry, swarmItem, swarmListing } from '../../../support/swarms';

const ACME = { id: 'org-acme', name: 'Acme' };
const FAILED: SwarmFailure = { code: 'failed', message: 'Git could not reach the repository.' };

const current = swarmItem({ installed: installedSwarm() });
const notInstalled = swarmItem();
const ready = swarmItem({ installed: installedSwarm({ version: '0.9.2' }), update: { target: '0.10.0', updating: false } });
const available = swarmItem({
  entry: swarmEntry({ kind: 'community' }),
  installed: installedSwarm({ kind: 'community', version: '2.1.0' }),
  update: { target: '2.2.0', updating: false },
});
const updating = swarmItem({ installed: installedSwarm(), update: { target: '1.5.0', updating: true } });
const failedUpdate = swarmItem({ installed: installedSwarm({ lastError: FAILED }), update: { target: '1.5.0', updating: false } });
const gone = swarmItem({ entry: null, installed: installedSwarm({ version: '1.2.0' }) });

describe('rowState', () => {
  it.each<[string, SwarmListItem, SwarmListing['source'], boolean, SwarmRowState]>([
    ['up to date', current, 'cloud', false, 'current'],
    ['not installed', notInstalled, 'cloud', false, 'not-installed'],
    ['a pending update of a native swarm', ready, 'cloud', false, 'ready'],
    ['a pending update of a community swarm', available, 'cloud', false, 'available'],
    ['an automatic update running', updating, 'cloud', false, 'updating'],
    ['a failed update', failedUpdate, 'cloud', false, 'failed-update'],
    ['gone from a fresh list', gone, 'cloud', false, 'gone'],
    ['busy over everything: not installed', notInstalled, 'cloud', true, 'updating'],
    ['busy over everything: failed update', failedUpdate, 'cloud', true, 'updating'],
    ['busy over everything: gone', gone, 'cloud', true, 'updating'],
    ['no row from the cache is not gone', gone, 'cache', false, 'current'],
    ['no row while signed out is not gone', gone, 'none', false, 'current'],
    ['failed-update over a pending update', failedUpdate, 'cloud', false, 'failed-update'],
  ])('%s', (_name, item, source, busy, expected) => {
    expect(rowState(item, source, busy)).toBe(expected);
  });
});

describe('stateText', () => {
  it.each<[SwarmRowState, SwarmListItem, string]>([
    ['current', current, 'v1.4.0 · up to date'],
    ['ready', ready, 'v0.9.2 · v0.10.0 is ready'],
    ['available', available, 'v2.1.0 · v2.2.0 available'],
    ['not-installed', notInstalled, 'Not installed'],
    ['updating', updating, 'Updating…'],
    ['failed-update', failedUpdate, 'v1.4.0 · update failed'],
    ['gone', gone, 'v1.2.0'],
  ])('%s', (state, item, expected) => {
    expect(stateText(state, item)).toBe(expected);
  });
});

describe('badgeOf, publisherOf and countsOf', () => {
  it.each<[string, SwarmListItem, string]>([
    ['native', current, 'Native'],
    ['community', available, 'Community'],
    ['an organization by name', swarmItem({ entry: swarmEntry({ kind: 'organization', org: ACME }) }), 'Acme'],
    [
      'an installed organization swarm with no row',
      swarmItem({ entry: null, installed: installedSwarm({ kind: 'organization', org: ACME }) }),
      'Acme',
    ],
    ['an organization with no name anywhere', swarmItem({ entry: swarmEntry({ kind: 'organization' }) }), 'Organization'],
  ])('badge: %s', (_name, item, expected) => {
    expect(badgeOf(item)).toBe(expected);
  });

  it("is the row's publisher, else the installed repository", () => {
    expect(publisherOf(current)).toBe('HiveTTY');
    expect(publisherOf(gone)).toBe('https://github.com/behiques/swarms.git');
    expect(publisherOf(swarmItem({ entry: swarmEntry({ publisher: '' }), installed: installedSwarm({ repoUrl: 'git@x:y' }) }))).toBe(
      'git@x:y',
    );
    expect(publisherOf(swarmItem({ entry: null }))).toBe('');
  });

  it.each<[SwarmContents, string]>([
    [{ agents: [], skills: [] }, '0 agents · 0 skills'],
    [{ agents: [{ name: 'a', description: '', tools: [] }], skills: [{ name: 's', description: '' }] }, '1 agent · 1 skill'],
    [
      {
        agents: [
          { name: 'a', description: '', tools: [] },
          { name: 'b', description: '', tools: [] },
        ],
        skills: [
          { name: 's', description: '' },
          { name: 't', description: '' },
        ],
      },
      '2 agents · 2 skills',
    ],
  ])('counts %#', (contents, expected) => {
    expect(countsOf(contents)).toBe(expected);
  });
});

describe('installedRows', () => {
  it('puts failed first installs first, then every installed item in listing order', () => {
    const failedFirst = swarmItem({ entry: swarmEntry({ id: 'kit', title: 'Kit' }) });
    const untouched = swarmItem({ entry: swarmEntry({ id: 'other' }) });
    const installedA = swarmItem({ entry: swarmEntry({ id: 'a' }), installed: installedSwarm({ swarmId: 'a' }) });
    const installedB = swarmItem({ entry: null, installed: installedSwarm({ swarmId: 'b' }) });
    const listing = swarmListing([installedA, untouched, failedFirst, installedB]);

    expect(installedRows(listing, new Map([['kit', FAILED]]))).toEqual([failedFirst, installedA, installedB]);
  });

  it('leaves a failure out once the swarm is installed', () => {
    const listing = swarmListing([current]);

    expect(installedRows(listing, new Map([['standard', FAILED]]))).toEqual([current]);
  });
});

describe('browseGroups', () => {
  it('orders Native, each organization by name, then Community; rows only; empty groups out', () => {
    const native = swarmItem({ entry: swarmEntry({ id: 'n' }) });
    const zeta = swarmItem({ entry: swarmEntry({ id: 'z', kind: 'organization', org: { id: 'o2', name: 'Zeta' } }) });
    const acme = swarmItem({ entry: swarmEntry({ id: 'a', kind: 'organization', org: ACME }) });
    const acme2 = swarmItem({ entry: swarmEntry({ id: 'a2', kind: 'organization', org: ACME }) });
    const community = swarmItem({ entry: swarmEntry({ id: 'c', kind: 'community' }) });
    const noRow = swarmItem({ entry: null, installed: installedSwarm() });

    const groups = browseGroups(swarmListing([community, zeta, noRow, acme, native, acme2]));

    expect(groups.map((group) => group.label)).toEqual(['Native', 'Acme', 'Zeta', 'Community']);
    expect(groups[1]?.items).toEqual([acme, acme2]);
  });

  it('leaves out an empty group', () => {
    expect(browseGroups(swarmListing([swarmItem({ entry: swarmEntry({ kind: 'community' }) })])).map((g) => g.label)).toEqual([
      'Community',
    ]);
  });
});

describe('matches', () => {
  const entry = swarmEntry({
    title: 'Standard',
    publisher: 'HiveTTY',
    description: 'Most work.',
    agents: [{ name: 'builder', description: '', tools: [] }],
    skills: [{ name: 'brainstorm', description: '' }],
  });

  it.each<[string, boolean]>([
    ['', true],
    ['   ', true],
    ['STAND', true],
    ['hivetty', true],
    ['most', true],
    ['builder', true],
    ['brainSTORM', true],
    ['reviewer', false],
  ])('%j → %s', (query, expected) => {
    expect(matches(entry, query)).toBe(expected);
  });
});

describe('diffContents', () => {
  const agent = (name: string, tools: string[]) => ({ name, description: '', tools });
  const skill = (name: string) => ({ name, description: '' });

  it('reports nothing when only the order of tools changed', () => {
    const before = { agents: [agent('builder', ['Read', 'Edit'])], skills: [] };
    const after = { agents: [agent('builder', ['Edit', 'Read'])], skills: [] };

    expect(diffContents(before, after)).toEqual({
      agentsAdded: [],
      agentsRemoved: [],
      skillsAdded: [],
      skillsRemoved: [],
      toolsChanged: [],
    });
  });

  it('reports an agent that gained and lost a tool', () => {
    const before = { agents: [agent('builder', ['Read', 'Edit'])], skills: [] };
    const after = { agents: [agent('builder', ['Read', 'Bash'])], skills: [] };

    expect(diffContents(before, after).toolsChanged).toEqual([{ name: 'builder', added: ['Bash'], removed: ['Edit'] }]);
  });

  it('reports agents and skills added and removed', () => {
    const before = { agents: [agent('builder', []), agent('old', [])], skills: [skill('tdd'), skill('gone')] };
    const after = { agents: [agent('builder', []), agent('new', ['Read'])], skills: [skill('tdd'), skill('fresh')] };

    expect(diffContents(before, after)).toEqual({
      agentsAdded: ['new'],
      agentsRemoved: ['old'],
      skillsAdded: ['fresh'],
      skillsRemoved: ['gone'],
      toolsChanged: [],
    });
  });
});

describe('keptFiles', () => {
  it('lists the held statuses the swarm names, agents first', () => {
    const installed = installedSwarm({
      contents: {
        agents: [
          { name: 'builder', description: '', tools: [] },
          { name: 'fixer', description: '', tools: [] },
        ],
        skills: [{ name: 'tdd', description: '' }],
      },
    });
    const heldBuilder = shippedStatus({ name: 'builder', held: true, bodyEdited: true });
    const notHeld = shippedStatus({ name: 'fixer', held: false, bodyEdited: true });
    const elsewhere = shippedStatus({ name: 'reviewer', held: true, bodyEdited: true });
    const heldSkill = shippedStatus({ kind: 'skills', name: 'tdd', held: true, bodyEdited: true });

    const kept = keptFiles(
      installed,
      new Map([
        ['builder', heldBuilder],
        ['fixer', notHeld],
        ['reviewer', elsewhere],
      ]),
      new Map([['tdd', heldSkill]]),
    );

    expect(kept).toEqual([
      { kind: 'agents', name: 'builder', status: heldBuilder },
      { kind: 'skills', name: 'tdd', status: heldSkill },
    ]);
  });
});

describe('needsConsent', () => {
  const organization = swarmItem({
    entry: swarmEntry({ kind: 'organization', org: ACME }),
    installed: installedSwarm({ kind: 'organization', org: ACME }),
  });

  const seen = notInstalled.entry === null ? '' : consentFingerprint(notInstalled.entry);

  it.each<[string, SwarmListItem, string | null, boolean]>([
    ['not installed', notInstalled, null, true],
    ['not installed, consented to this very row before (Try again)', notInstalled, seen, false],
    ['installed community', available, null, true],
    ['installed native', current, null, false],
    ['installed organization', organization, null, false],
    ['installed community, an earlier consent never skips the review', available, seen, true],
    ['installed community with no row (kind from the installed entry)', swarmItem({ entry: null, installed: installedSwarm({ kind: 'community' }) }), null, true],
  ])('%s', (_name, item, consented, expected) => {
    expect(needsConsent(item, consented)).toBe(expected);
  });

  it.each<[string, Partial<Parameters<typeof swarmEntry>[0]>]>([
    ['a new version', { version: '1.5.0' }],
    ['a new commit', { commit: 'b'.repeat(40) }],
    ['a tool added to an agent', { agents: [{ name: 'builder', description: 'Builds plans.', tools: ['Read', 'Edit', 'Bash', 'WebFetch'] }] }],
    ['a new agent', { agents: [...swarmEntry().agents, { name: 'spy', description: 'x', tools: ['Bash'] }] }],
    ['a new skill', { skills: [...swarmEntry().skills, { name: 'exfil', description: 'x' }] }],
    ['a new pin', { policy: 'pinned', pinnedVersion: '2.0.0' }],
  ])('a retry asks again when the registry row changed since consent: %s', (_name, over) => {
    expect(needsConsent(swarmItem({ entry: swarmEntry(over) }), seen)).toBe(true);
  });

  it.each<[string, SwarmListItem]>([
    [
      'the registry now calls it native, the installed entry community',
      swarmItem({ entry: swarmEntry({ kind: 'native' }), installed: installedSwarm({ kind: 'community' }) }),
    ],
    [
      'the registry now calls it community, the installed entry native',
      swarmItem({ entry: swarmEntry({ kind: 'community' }), installed: installedSwarm({ kind: 'native' }) }),
    ],
  ])('asks when either kind is community: %s', (_name, item) => {
    expect(needsConsent(item)).toBe(true);
  });

  it('a description or install count moving does not ask again', () => {
    expect(needsConsent(swarmItem({ entry: swarmEntry({ description: 'Reworded.', installs: 99 }) }), seen)).toBe(false);
  });

  it('defaults to no earlier consent', () => {
    expect(needsConsent(notInstalled)).toBe(true);
  });
});

describe('installVersionOf', () => {
  it('is the pinned version for a pinned organization swarm, which is what installs', () => {
    expect(
      installVersionOf(swarmEntry({ kind: 'organization', org: ACME, version: '1.4.0', policy: 'pinned', pinnedVersion: '1.2.0' })),
    ).toBe('1.2.0');
  });

  it("is the registry's version otherwise", () => {
    expect(installVersionOf(swarmEntry({ version: '1.4.0' }))).toBe('1.4.0');
    expect(installVersionOf(swarmEntry({ kind: 'organization', org: ACME, policy: 'latest', version: '1.4.0' }))).toBe('1.4.0');
    expect(installVersionOf(swarmEntry({ kind: 'organization', org: ACME, policy: 'pinned', pinnedVersion: null, version: '1.4.0' }))).toBe('1.4.0');
  });
});

describe('rowState while removing', () => {
  it('reads removing, not updating', () => {
    expect(rowState(current, 'cloud', true, true)).toBe('removing');
    expect(stateText('removing', current)).toBe('Removing…');
  });
});
