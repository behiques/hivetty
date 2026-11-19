import type { SwarmFailure, SwarmListing } from '@shared/swarm-contract';

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

/** Test-only: drop the snapshot, the change subscription and every subscriber. */
export function resetSwarmsState(): void {
  unsubscribeChanged?.();
  unsubscribeChanged = null;
  snapshot = EMPTY;
  listeners.clear();
}
