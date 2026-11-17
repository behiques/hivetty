import type { RelayHostsResult, RelayServeStatus } from '@shared/relay-contract';

/**
 * The renderer's door onto this machine's managed-relay serving state (HIVE-429). The `licence.ts` shape: no
 * bridge (the browser target) answers `off`, and a refusal from main is logged and answered `off` rather than
 * thrown into a render.
 */

const OFF: RelayServeStatus = { state: 'off' };

export async function readRelayStatus(): Promise<RelayServeStatus> {
  const bridge = window.hive;
  if (!bridge) return OFF;
  try {
    return await bridge.relay.status();
  } catch (cause) {
    console.error('[hive] reading the relay status failed:', cause);
    return OFF;
  }
}

/** Every change main pushes; a no-op unsubscribe with no bridge. */
export function onRelayStatusChanged(callback: (status: RelayServeStatus) => void): () => void {
  const bridge = window.hive;
  if (!bridge) return () => undefined;
  return bridge.relay.onStatus(callback);
}

const UNAVAILABLE: RelayHostsResult = { ok: false, reason: 'unavailable' };

/** This account's Macs serving the relay now (HIVE-429); `unavailable` with no bridge or when main refuses. */
export async function listRelayHosts(): Promise<RelayHostsResult> {
  const bridge = window.hive;
  if (!bridge) return UNAVAILABLE;
  try {
    return await bridge.relay.hosts();
  } catch (cause) {
    console.error('[hive] listing the relay servers failed:', cause);
    return UNAVAILABLE;
  }
}
