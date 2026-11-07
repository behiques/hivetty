import type { AccountDevice, DevicesResult } from '@shared/account-contract';

/** Account & devices (HIVE-265 against HIVE-262's `GET /api/account/devices`). The body is checked here, at the trust boundary. */
const FAILED = "Couldn't load your devices.";

function deviceOf(row: unknown): AccountDevice | null {
  if (typeof row !== 'object' || row === null) return null;
  const { id, name, lastSeenAt, createdAt, current } = row as Record<string, unknown>;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof lastSeenAt !== 'string') return null;
  if (typeof createdAt !== 'string' || typeof current !== 'boolean') return null;
  return { id, name, lastSeenAt, createdAt, current };
}

export async function listDevices(
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<DevicesResult> {
  let response: Response;
  try {
    response = await authedFetch('/api/account/devices');
  } catch {
    return { error: "Couldn't reach HiveTTY. Try again." };
  }
  if (!response.ok) return { error: FAILED };
  const body: unknown = await response.json().catch(() => null);
  const rows = (body as { devices?: unknown } | null)?.devices;
  if (!Array.isArray(rows)) return { error: FAILED };
  const devices = rows.map(deviceOf);
  return devices.every((device): device is AccountDevice => device !== null) ? { devices } : { error: FAILED };
}
