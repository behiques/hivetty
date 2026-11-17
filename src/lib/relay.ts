import type { RelayServeStatus } from '@shared/relay-contract';

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
