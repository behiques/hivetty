import { onCounts } from '@/lib/swarms';

import type { ShippedStatus } from '@shared/shipped-contract';
import {
  disabledOf,
  isBundled,
  versionLabel,
  type InstalledSwarm,
  type SwarmContents,
  type SwarmEntry,
  type SwarmFailure,
  type SwarmItemKind,
  type SwarmListing,
  type SwarmListItem,
} from '@shared/swarm-contract';

export type SwarmRowState =
  | 'not-installed'
  | 'updating'
  | 'removing'
  | 'available'
  | 'ready'
  | 'failed-update'
  | 'gone'
  | 'current';

export function rowState(
  item: SwarmListItem,
  source: SwarmListing['source'],
  busy: boolean,
  removing = false,
): SwarmRowState {
  if (removing) return 'removing';
  if (busy || item.update?.updating === true) return 'updating';
  if (item.installed === null) return 'not-installed';
  // Offline and signed out, every installed swarm has no row: only a fresh list says it left.
  if (item.entry === null) return source === 'cloud' ? 'gone' : 'current';
  if (item.installed.lastError !== null) return 'failed-update';
  if (item.update !== null) return item.entry.kind === 'community' ? 'available' : 'ready';
  return 'current';
}

export function stateText(state: SwarmRowState, item: SwarmListItem): string {
  const version = item.installed === null ? '' : versionLabel(item.installed.version);
  const target = item.update === null ? '' : `v${item.update.target}`;
  switch (state) {
    case 'not-installed':
      return 'Not installed';
    case 'updating':
      return 'Updating…';
    case 'removing':
      return 'Removing…';
    case 'available':
      return `${version} · ${target} available`;
    case 'ready':
      return `${version} · ${target} is ready`;
    case 'failed-update':
      return `${version} · update failed`;
    case 'gone':
      return version;
    case 'current':
      // "bundled" is older than every release: never claim it is up to date.
      return item.installed !== null && isBundled(item.installed.version) ? version : `${version} · up to date`;
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

/** HIVE-453: "3 of 4 agents and 13 of 14 skills on", for an installed swarm. */
export function onCountsText(item: SwarmListItem): string {
  const counts = onCounts(item);
  return `${String(counts.agentsOn)} of ${plural(counts.agents, 'agent')} and ${String(counts.skillsOn)} of ${plural(counts.skills, 'skill')} on`;
}

/** One agent or skill a swarm row names by kind (HIVE-453). */
export interface SwarmItemRow {
  kind: SwarmItemKind;
  name: string;
}

const byName = (left: string, right: string): number => left.localeCompare(right);

const rowsOf = (agents: readonly string[], skills: readonly string[]): SwarmItemRow[] => [
  ...[...agents].sort(byName).map((name) => ({ kind: 'agents' as const, name })),
  ...[...skills].sort(byName).map((name) => ({ kind: 'skills' as const, name })),
];

/**
 * HIVE-453: what the person turned off, agents first, each sorted. Only names the swarm still ships, as `onCounts`
 * counts them.
 */
export function turnedOff(item: SwarmListItem): SwarmItemRow[] {
  const installed = item.installed;
  if (installed === null) return [];
  const off = disabledOf(installed);
  const shipped = (kind: SwarmItemKind) =>
    off[kind].filter((name) => installed.contents[kind].some((element) => element.name === name));
  return rowsOf(shipped('agents'), shipped('skills'));
}

/** HIVE-453: what the swarm's record tracks that is gone from disk, agents first, each sorted. */
export function missingOf(item: SwarmListItem): SwarmItemRow[] {
  return rowsOf(item.missing.agents, item.missing.skills);
}

/** HIVE-453: "1 agent and 1 skill turned off", "2 skills missing". */
export function offHeading(rows: readonly SwarmItemRow[], what: string): string {
  const agents = rows.filter((row) => row.kind === 'agents').length;
  const skills = rows.length - agents;
  const parts = [agents > 0 ? plural(agents, 'agent') : null, skills > 0 ? plural(skills, 'skill') : null].filter(
    (part): part is string => part !== null,
  );
  return `${parts.join(' and ')} ${what}`;
}

/** A skill reads as its command, an agent as its name. */
export const itemLabel = (row: SwarmItemRow): string => (row.kind === 'skills' ? `/${row.name}` : row.name);

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

/** The version an install of this row lands: a pinned organization swarm installs its pin, not the registry's newest. */
export function installVersionOf(entry: SwarmEntry): string | null {
  return entry.kind === 'organization' && entry.policy === 'pinned' && entry.pinnedVersion !== null
    ? entry.pinnedVersion
    : entry.version;
}

/**
 * Whether the consent dialog comes before `swarms:install` (HIVE-442): before every install of a swarm that is
 * not installed, a retry included (the registry row may have moved since the failure), and before every
 * community update.
 */
export function needsConsent(item: SwarmListItem): boolean {
  if (item.installed === null) return true;
  // Either kind: a registry that relabels a community swarm must not let its next update through unseen.
  return item.entry?.kind === 'community' || item.installed.kind === 'community';
}

export type InstallLinkResolution =
  | { kind: 'sign-in' }
  | { kind: 'wait' }
  | { kind: 'consent'; item: SwarmListItem }
  | { kind: 'installed' }
  | { kind: 'unavailable' };

/**
 * What an install link's swarm id leads to (HIVE-442). Never an install: the furthest it goes is the consent
 * dialog, whose Install button is the person's.
 */
export function resolveInstallLink(
  swarmId: string,
  signedIn: boolean,
  listing: SwarmListing | null,
): InstallLinkResolution {
  if (!signedIn) return { kind: 'sign-in' };
  if (listing === null) return { kind: 'wait' };
  const item = listing.items.find((row) => (row.entry?.id ?? row.installed?.swarmId) === swarmId);
  if (item?.installed != null) return { kind: 'installed' };
  if (item !== undefined) return { kind: 'consent', item };
  // Only a fresh list can say the account has no such swarm.
  return listing.source === 'cloud' ? { kind: 'unavailable' } : { kind: 'wait' };
}
