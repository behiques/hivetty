import type { AccountDevice, DevicesResult, RevokeResult } from '@shared/account-contract';

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

/** The longest device id `revokeDevice` sends: the cloud's are uuids. */
const MAX_DEVICE_ID = 128;
const NOT_HERE = "Couldn't remove that device here. Use Manage devices.";

/** Remove: the cloud revokes the device and its refresh tokens. The id crosses IPC, so it is checked and escaped. */
export async function revokeDevice(
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>,
  id: unknown,
): Promise<RevokeResult> {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_DEVICE_ID) return { error: 'That is not a device.' };
  let response: Response;
  try {
    response = await authedFetch(`/api/account/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
  } catch {
    return { error: NOT_HERE };
  }
  if (response.ok) return { ok: true };
  return { error: response.status === 404 ? 'That device was already removed.' : NOT_HERE };
}
