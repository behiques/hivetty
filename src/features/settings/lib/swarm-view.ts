import type { ShippedStatus } from '@shared/shipped-contract';
import type {
  InstalledSwarm,
  SwarmContents,
  SwarmEntry,
  SwarmFailure,
  SwarmListing,
  SwarmListItem,
} from '@shared/swarm-contract';

export type SwarmRowState =
  | 'not-installed'
  | 'updating'
  | 'available'
  | 'ready'
  | 'failed-update'
  | 'gone'
  | 'current';

export function rowState(item: SwarmListItem, source: SwarmListing['source'], busy: boolean): SwarmRowState {
  if (busy || item.update?.updating === true) return 'updating';
  if (item.installed === null) return 'not-installed';
  // Offline and signed out, every installed swarm has no row: only a fresh list says it left.
  if (item.entry === null) return source === 'cloud' ? 'gone' : 'current';
  if (item.installed.lastError !== null) return 'failed-update';
  if (item.update !== null) return item.entry.kind === 'community' ? 'available' : 'ready';
  return 'current';
}

export function stateText(state: SwarmRowState, item: SwarmListItem): string {
  const version = item.installed === null ? '' : `v${item.installed.version}`;
  const target = item.update === null ? '' : `v${item.update.target}`;
  switch (state) {
    case 'not-installed':
      return 'Not installed';
    case 'updating':
      return 'Updating…';
    case 'available':
      return `${version} · ${target} available`;
    case 'ready':
      return `${version} · ${target} is ready`;
    case 'failed-update':
      return `${version} · update failed`;
    case 'gone':
      return version;
    case 'current':
      return `${version} · up to date`;
  }
}

const kindOf = (item: SwarmListItem) => item.entry?.kind ?? item.installed?.kind;
const orgOf = (item: SwarmListItem) => item.entry?.org ?? item.installed?.org ?? null;

export function badgeOf(item: SwarmListItem): string {
  const kind = kindOf(item);
  if (kind === 'native') return 'Native';
  if (kind === 'community') return 'Community';
  return orgOf(item)?.name ?? 'Organization';
}

export const publisherOf = (item: SwarmListItem): string =>
  item.entry?.publisher || item.installed?.repoUrl || '';

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export const countsOf = (contents: SwarmContents): string =>
  `${plural(contents.agents.length, 'agent')} · ${plural(contents.skills.length, 'skill')}`;

export function installedRows(
  listing: SwarmListing,
  failures: ReadonlyMap<string, SwarmFailure>,
): SwarmListItem[] {
  const failed = listing.items.filter(
    (item) => item.installed === null && item.entry !== null && failures.has(item.entry.id),
  );
  return [...failed, ...listing.items.filter((item) => item.installed !== null)];
}

export interface BrowseGroup {
  label: string;
  items: (SwarmListItem & { entry: SwarmEntry })[];
}

export function browseGroups(listing: SwarmListing): BrowseGroup[] {
  const rows = listing.items.filter((item): item is SwarmListItem & { entry: SwarmEntry } => item.entry !== null);
  const orgs = [...new Set(rows.filter((item) => item.entry.kind === 'organization').map((item) => badgeOf(item)))].sort(
    (left, right) => left.localeCompare(right),
  );
  return [
    { label: 'Native', items: rows.filter((item) => item.entry.kind === 'native') },
    ...orgs.map((label) => ({
      label,
      items: rows.filter((item) => item.entry.kind === 'organization' && badgeOf(item) === label),
    })),
    { label: 'Community', items: rows.filter((item) => item.entry.kind === 'community') },
  ].filter((group) => group.items.length > 0);
}

export function matches(entry: SwarmEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [
    entry.title,
    entry.publisher,
    entry.description,
    ...entry.agents.map((agent) => agent.name),
    ...entry.skills.map((skill) => skill.name),
  ].some((text) => text.toLowerCase().includes(needle));
}

export interface ContentsDiff {
  agentsAdded: string[];
  agentsRemoved: string[];
  skillsAdded: string[];
  skillsRemoved: string[];
  toolsChanged: { name: string; added: string[]; removed: string[] }[];
}

export function diffContents(before: SwarmContents, after: SwarmContents): ContentsDiff {
  const names = (rows: { name: string }[]): Set<string> => new Set(rows.map((row) => row.name));
  const only = (left: Set<string>, right: Set<string>): string[] => [...left].filter((name) => !right.has(name));
  const agentsBefore = names(before.agents);
  const agentsAfter = names(after.agents);
  const skillsBefore = names(before.skills);
  const skillsAfter = names(after.skills);

  const toolsChanged = after.agents.flatMap((agent) => {
    const was = before.agents.find((held) => held.name === agent.name);
    if (was === undefined) return [];
    const added = agent.tools.filter((tool) => !was.tools.includes(tool));
    const removed = was.tools.filter((tool) => !agent.tools.includes(tool));
    return added.length === 0 && removed.length === 0 ? [] : [{ name: agent.name, added, removed }];
  });

  return {
    agentsAdded: only(agentsAfter, agentsBefore),
    agentsRemoved: only(agentsBefore, agentsAfter),
    skillsAdded: only(skillsAfter, skillsBefore),
    skillsRemoved: only(skillsBefore, skillsAfter),
    toolsChanged,
  };
}

export interface KeptFile {
  kind: 'agents' | 'skills';
  name: string;
  status: ShippedStatus;
}

/** A status row has no swarm id: a file is this swarm's when the swarm's contents name it. */
export function keptFiles(
  installed: InstalledSwarm,
  agents: ReadonlyMap<string, ShippedStatus>,
  skills: ReadonlyMap<string, ShippedStatus>,
): KeptFile[] {
  const held = (kind: KeptFile['kind'], rows: { name: string }[], statuses: ReadonlyMap<string, ShippedStatus>) =>
    rows.flatMap((row) => {
      const status = statuses.get(row.name);
      return status !== undefined && status.held ? [{ kind, name: row.name, status }] : [];
    });
  return [
    ...held('agents', installed.contents.agents, agents),
    ...held('skills', installed.contents.skills, skills),
  ];
}

/**
 * Whether the consent dialog comes before `swarms:install` (HIVE-442): before every first install, and before
 * every community update. `retry` is Try again on an install that failed in this run, which was already consented to.
 */
export function needsConsent(item: SwarmListItem, retry = false): boolean {
  if (item.installed === null) return !retry;
  // Either kind: a registry that relabels a community swarm must not let its next update through unseen.
  return item.entry?.kind === 'community' || item.installed.kind === 'community';
}
