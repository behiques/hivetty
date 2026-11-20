import type { AgentSummary } from '@shared/agent-contract';
import {
  disabledOf,
  isBundled,
  type SwarmFailure,
  type SwarmItemKind,
  type SwarmListItem,
  type SwarmListing,
} from '@shared/swarm-contract';

/**
 * The renderer's view of the installed swarms and the registry (HIVE-442).
 *
 * `shipped.ts`'s shape: a module snapshot behind `useSyncExternalStore` and a
 * load that is safe to repeat. Beside the listing it holds what only this run
 * knows: the ids with a call in flight, the first installs that failed (main
 * keeps no entry for those, so the pane would have nothing to show), and the
 * last update `swarms:changed` announced.
 */

export interface SwarmsSnapshot {
  listing: SwarmListing | null;
  busy: ReadonlySet<string>;
  /** The ids whose call in flight is a removal, so the row reads "Removing…" and not "Updating…". */
  removing: ReadonlySet<string>;
  failures: ReadonlyMap<string, SwarmFailure>;
  lastUpdate: { title: string; version: string } | null;
}

const EMPTY: SwarmsSnapshot = {
  listing: null,
  busy: new Set(),
  removing: new Set(),
  failures: new Map(),
  lastUpdate: null,
};

let snapshot: SwarmsSnapshot = EMPTY;
let unsubscribeChanged: (() => void) | null = null;
const listeners = new Set<() => void>();

/** Replace the snapshot, never mutate it, and tell every listener once. */
function publish(next: Partial<SwarmsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export function subscribeSwarms(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function swarmsSnapshot(): SwarmsSnapshot {
  return snapshot;
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

function setBusy(swarmId: string, on: boolean, removal = false): void {
  const busy = new Set(snapshot.busy);
  const removing = new Set(snapshot.removing);
  if (on) busy.add(swarmId);
  else busy.delete(swarmId);
  if (on && removal) removing.add(swarmId);
  else removing.delete(swarmId);
  publish({ busy, removing });
}

/**
 * A held failure of an installed swarm (a rejected update call) lasts while its update is still pending; once the
 * listing shows none, it was applied or withdrawn, and the message would be stale.
 */
function pruneFailures(listing: SwarmListing): void {
  const settled = listing.items.filter(
    (item) => item.installed !== null && item.update === null && snapshot.failures.has(item.installed.swarmId),
  );
  if (settled.length === 0) return;
  const failures = new Map(snapshot.failures);
  for (const item of settled) if (item.installed !== null) failures.delete(item.installed.swarmId);
  publish({ failures });
}

function setFailure(swarmId: string, failure: SwarmFailure | null): void {
  if (failure === null && !snapshot.failures.has(swarmId)) return;
  const failures = new Map(snapshot.failures);
  if (failure === null) failures.delete(swarmId);
  else failures.set(swarmId, failure);
  publish({ failures });
}

/** Ask main for the list. Safe to call repeatedly; a failed read keeps what was held. */
export async function loadSwarms(): Promise<void> {
  const bridge = window.hive;

  if (!bridge) return;

  if (unsubscribeChanged === null) {
    unsubscribeChanged = bridge.swarms.onChanged((event) => {
      if (event.updated !== null) {
        publish({ lastUpdate: { title: event.updated.title, version: event.updated.version } });
      }
      void loadSwarms();
    });
  }

  try {
    const listing = await bridge.swarms.list();
    publish({ listing });
    pruneFailures(listing);
  } catch (cause) {
    console.error('[hive] could not list the swarms:', cause);
  }
}

/** Ask main to check the registry now; it answers the list after the check. */
export async function checkSwarms(): Promise<void> {
  const bridge = window.hive;

  if (!bridge) return;

  try {
    publish({ listing: await bridge.swarms.check() });
  } catch (cause) {
    console.error('[hive] could not check the swarms for updates:', cause);
  }
}

const isInstalled = (swarmId: string): boolean =>
  snapshot.listing?.items.some((item) => item.installed?.swarmId === swarmId) ?? false;

/**
 * Install, or update an installed swarm. True when it installed. A failed
 * first install is held here as the row's "Not installed"; a failed update
 * comes back as the installed entry's `lastError`, so it is not held twice,
 * unless the call itself was rejected and main recorded nothing.
 */
export async function installSwarm(swarmId: string): Promise<boolean> {
  const bridge = window.hive;

  if (!bridge) return false;

  setBusy(swarmId, true);
  let failure: SwarmFailure | null = null;
  let rejected = false;
  try {
    const result = await bridge.swarms.install({ swarmId });
    if (!result.ok) failure = result.failure;
  } catch (cause) {
    failure = { code: 'failed', message: messageOf(cause) };
    rejected = true;
  }
  setBusy(swarmId, false);

  if (failure === null) setFailure(swarmId, null);
  else if (rejected || !isInstalled(swarmId)) setFailure(swarmId, failure);

  await loadSwarms();

  return failure === null;
}

/** Remove an installed swarm; `null` when it was removed, else the sentence saying why not. */
export async function removeSwarm(swarmId: string): Promise<string | null> {
  const bridge = window.hive;

  if (!bridge) return null;

  setBusy(swarmId, true, true);
  let message: string | null = null;
  try {
    const result = await bridge.swarms.remove({ swarmId });
    if (!result.ok) message = result.failure.message;
  } catch (cause) {
    message = messageOf(cause);
  }
  setBusy(swarmId, false);

  await loadSwarms();

  return message;
}

export async function setSwarmAutoUpdate(swarmId: string, autoUpdate: boolean): Promise<void> {
  const bridge = window.hive;

  if (!bridge) return;

  try {
    await bridge.swarms.setAutoUpdate({ swarmId, autoUpdate });
  } catch (cause) {
    console.error('[hive] could not set the swarm to update automatically:', cause);
  }

  await loadSwarms();
}

/** Forget a failed first install: the row goes away. */
export function dismissSwarmFailure(swarmId: string): void {
  setFailure(swarmId, null);
}

/** HIVE-442: the swarm an install link named, once; null when there is none or no bridge. */
export async function takeSwarmInstallRequest(): Promise<string | null> {
  const bridge = window.hive;

  if (!bridge) return null;

  return bridge.swarms.takeInstallRequest();
}

/** HIVE-442: an install link arrived; take it with {@link takeSwarmInstallRequest}. */
export function onSwarmInstallRequested(callback: () => void): () => void {
  const bridge = window.hive;

  if (!bridge) return () => undefined;

  return bridge.swarms.onInstallRequested(callback);
}

/**
 * HIVE-447: the registry swarm, not installed, that provides an agent or a skill of this name. Native rows come
 * first, then listing order. Null for a null listing, no match, or a match already installed.
 */
export function providerOf(
  listing: SwarmListing | null,
  kind: 'agent' | 'skill',
  name: string,
): { id: string; title: string } | null {
  if (listing === null) return null;

  const provides = (item: SwarmListItem): boolean =>
    item.entry !== null &&
    item.installed === null &&
    (kind === 'agent' ? item.entry.agents : item.entry.skills).some((element) => element.name === name);
  const match =
    listing.items.find((item) => item.entry?.kind === 'native' && provides(item)) ?? listing.items.find(provides);

  return match?.entry ? { id: match.entry.id, title: match.entry.title } : null;
}

/** HIVE-447: the registry's native Dev Squad row, and whether it is installed; null when the listing has none. */
export function devSquadOf(listing: SwarmListing | null): { id: string; installed: boolean } | null {
  const row = listing?.items.find((item) => item.entry?.kind === 'native' && item.entry.slug === 'dev-squad');

  return row?.entry ? { id: row.entry.id, installed: row.installed !== null } : null;
}

/** HIVE-453: the installed swarm that shipped an agent or a skill, and whether the person has it on. */
export interface SwarmOwner {
  swarmId: string;
  title: string;
  bundled: boolean;
  on: boolean;
}

/** HIVE-453: the installed swarm whose contents list this name; null when none does, or with no listing. */
export function swarmOwnerOf(listing: SwarmListing | null, kind: SwarmItemKind, name: string): SwarmOwner | null {
  const installed = listing?.items.find((item) =>
    item.installed?.contents[kind].some((element) => element.name === name),
  )?.installed;

  if (!installed) return null;

  return {
    swarmId: installed.swarmId,
    title: installed.title,
    bundled: isBundled(installed.version),
    on: !disabledOf(installed)[kind].includes(name),
  };
}

/** HIVE-453: how many of an installed swarm's agents and skills are on. Off names it no longer ships do not count. */
export function onCounts(item: SwarmListItem): { agentsOn: number; agents: number; skillsOn: number; skills: number } {
  const installed = item.installed;

  if (installed === null) return { agentsOn: 0, agents: 0, skillsOn: 0, skills: 0 };

  const off = disabledOf(installed);
  const onOf = (kind: SwarmItemKind): number =>
    installed.contents[kind].filter((element) => !off[kind].includes(element.name)).length;

  return {
    agentsOn: onOf('agents'),
    agents: installed.contents.agents.length,
    skillsOn: onOf('skills'),
    skills: installed.contents.skills.length,
  };
}

/** An agent that would act: its definition parsed, and it is not one of a swarm's agents turned off. */
const enabledAgent = (listing: SwarmListing | null, agent: AgentSummary): boolean =>
  agent.invalid === undefined && swarmOwnerOf(listing, 'agents', agent.name)?.on !== false;

/** HIVE-453: the enabled agents whose `skills:` list this skill, in the order given: who turning it off affects. */
export function skillUsers(listing: SwarmListing | null, agents: readonly AgentSummary[], skill: string): string[] {
  return agents
    .filter((agent) => agent.skills.includes(skill) && enabledAgent(listing, agent))
    .map((agent) => agent.name);
}

/**
 * HIVE-453: the enabled agents of the same swarm named in this agent's `asks_from:`, in that order: whose handoffs
 * turning it off refuses. The `sess-*` wildcard is a person, not a flow, and is left out.
 */
export function swarmAskers(listing: SwarmListing | null, agents: readonly AgentSummary[], name: string): string[] {
  const owner = swarmOwnerOf(listing, 'agents', name);
  const target = agents.find((agent) => agent.name === name);

  if (owner === null || target === undefined) return [];

  return (target.asksFrom ?? []).filter((asker) => {
    if (asker.startsWith('sess-')) return false;
    const agent = agents.find((candidate) => candidate.name === asker);
    return (
      agent !== undefined &&
      swarmOwnerOf(listing, 'agents', asker)?.swarmId === owner.swarmId &&
      enabledAgent(listing, agent)
    );
  });
}

/** "a", "a and b", "a, b and c". */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** HIVE-453: turn one of a swarm's items on or off. True when main wrote it; the list is reloaded either way. */
export async function setSwarmItemEnabled(
  swarmId: string,
  kind: SwarmItemKind,
  name: string,
  enabled: boolean,
): Promise<boolean> {
  const bridge = window.hive;

  if (!bridge) return false;

  let written = false;
  try {
    written = (await bridge.swarms.setEnabled({ swarmId, kind, name, enabled })) !== null;
  } catch (cause) {
    console.error('[hive] could not turn the swarm item on or off:', cause);
  }

  await loadSwarms();

  return written;
}

/** HIVE-453: put a missing item back from its swarm; null when it was restored, else the message saying why not. */
export async function restoreSwarmItem(kind: SwarmItemKind, name: string): Promise<string | null> {
  const bridge = window.hive;

  if (!bridge) return null;

  let message: string | null = null;
  try {
    await bridge.shipped.reset({ kind, name });
  } catch (cause) {
    message = messageOf(cause);
  }

  await loadSwarms();

  return message;
}

/** Test-only: drop the snapshot, the change subscription and every subscriber. */
export function resetSwarmsState(): void {
  unsubscribeChanged?.();
  unsubscribeChanged = null;
  snapshot = EMPTY;
  listeners.clear();
}
