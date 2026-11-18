import type { SetSyncGroupRequest, SyncedAppearance, SyncSetupResult, SyncStatus } from '@shared/sync-contract';

/**
 * The renderer's door onto settings sync (HIVE-284), the `account.ts` shape: no bridge (the browser target)
 * answers `null` or does nothing, and a refusal from main is logged and answered the same way rather than thrown
 * into a render. The passphrase is passed through and never logged.
 */

export async function readSyncStatus(): Promise<SyncStatus | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.sync.status();
  } catch (cause) {
    console.error('[hive] reading the sync status failed:', cause);
    return null;
  }
}

export function onSyncStatusChanged(callback: (status: SyncStatus) => void): () => void {
  return window.hive?.sync.onStatus(callback) ?? (() => undefined);
}

export async function setupSync(passphrase: string): Promise<SyncSetupResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.sync.setup(passphrase);
  } catch (cause) {
    console.error('[hive] turning on sync failed:', cause);
    return null;
  }
}

export async function setSyncGroup(request: SetSyncGroupRequest): Promise<void> {
  try {
    await window.hive?.sync.setGroup(request);
  } catch (cause) {
    console.error('[hive] switching a sync group failed:', cause);
  }
}

export async function syncNow(): Promise<void> {
  try {
    await window.hive?.sync.now();
  } catch (cause) {
    console.error('[hive] syncing failed:', cause);
  }
}

export async function resetSync(): Promise<SyncSetupResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.sync.reset();
  } catch (cause) {
    console.error('[hive] resetting sync failed:', cause);
    return null;
  }
}

export async function openSyncConflicts(): Promise<void> {
  try {
    await window.hive?.sync.openConflicts();
  } catch (cause) {
    console.error('[hive] opening the conflicts folder failed:', cause);
  }
}

export async function reportAppearance(fields: SyncedAppearance): Promise<void> {
  try {
    await window.hive?.sync.reportAppearance(fields);
  } catch (cause) {
    console.error('[hive] reporting appearance to sync failed:', cause);
  }
}

export function onApplyAppearance(callback: (fields: SyncedAppearance) => void): () => void {
  return window.hive?.sync.onApplyAppearance(callback) ?? (() => undefined);
}
