import type {
  InstalledSwarm,
  SwarmEntry,
  SwarmListItem,
  SwarmListing,
} from '../../shared/swarm-contract';

/** A registry row: the native Standard swarm unless `over` says otherwise. */
export const swarmEntry = (over: Partial<SwarmEntry> = {}): SwarmEntry => ({
  id: 'standard',
  slug: 'standard',
  kind: 'native',
  title: 'Standard',
  description: 'The agents and skills most work needs.',
  publisher: 'HiveTTY',
  tags: [],
  version: '1.4.0',
  updatedAt: '2026-11-19T00:00:00.000Z',
  installs: 12,
  agents: [{ name: 'builder', description: 'Builds plans.', tools: ['Read', 'Edit', 'Bash'] }],
  skills: [{ name: 'tdd', description: 'Test first.' }],
  repoUrl: 'https://github.com/behiques/swarms.git',
  folder: 'standard',
  commit: null,
  access: 'anonymous',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
  ...over,
});

/** An installed entry for the Standard swarm unless `over` says otherwise. */
export const installedSwarm = (over: Partial<InstalledSwarm> = {}): InstalledSwarm => ({
  swarmId: 'standard',
  slug: 'standard',
  kind: 'native',
  org: null,
  repoUrl: 'https://github.com/behiques/swarms.git',
  folder: 'standard',
  version: '1.4.0',
  commit: 'a'.repeat(40),
  installedAt: '2026-11-19T00:00:00.000Z',
  autoUpdate: true,
  lastError: null,
  title: 'Standard',
  description: 'The agents and skills most work needs.',
  contents: {
    agents: [{ name: 'builder', description: 'Builds plans.', tools: ['Read', 'Edit', 'Bash'] }],
    skills: [{ name: 'tdd', description: 'Test first.' }],
  },
  ...over,
});

export const swarmItem = (over: Partial<SwarmListItem> = {}): SwarmListItem => ({
  entry: swarmEntry(),
  installed: null,
  update: null,
  ...over,
});

export const swarmListing = (items: SwarmListItem[], source: SwarmListing['source'] = 'cloud'): SwarmListing => ({
  source,
  items,
});
