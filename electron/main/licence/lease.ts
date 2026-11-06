import { readFileSync, renameSync, writeFileSync } from 'node:fs';

import type { LapseReason } from '@shared/licence-contract';

import { CloudError, stringField } from './cloud';

/**
 * `<userData>/lease.jws` (HIVE-267). Plain text: a lease is signed, not secret, and verified on every launch.
 * Written to a temp file and renamed, so a crash mid-write never leaves half a lease.
 */
export interface LeaseFile {
  read(): string | null;
  write(jws: string): void;
}

export function createLeaseFile(filePath: string): LeaseFile {
  return {
    read() {
      try {
        const text = readFileSync(filePath, 'utf8').trim();
        return text === '' ? null : text;
      } catch {
        return null;
      }
    },
    write(jws) {
      const temp = `${filePath}.tmp`;
      writeFileSync(temp, jws, 'utf8');
      renameSync(temp, filePath);
    },
  };
}

export type RenewResult =
  | { kind: 'lease'; jws: string }
  | { kind: 'refused'; reason: LapseReason }
  | { kind: 'signed-out' }
  | { kind: 'failed'; detail: string };

const REASONS: readonly LapseReason[] = [
  'trial_ended',
  'plan_cancelled',
  'payment_failed',
  'device_revoked',
  'seat_removed',
  'no_plan',
];

/**
 * One `POST /api/lease` (HIVE-272): 200 `{ lease }`, 403 `{ error: 'lease_refused', reason }`, 401 for a bad
 * token. A `device_revoked` 401 is `authedFetch`'s to act on: it signs the device out, and the licence follows
 * the account. Every other 401 is a failure: HIVE-264 refreshes the token on the next call.
 */
export async function renewLease(
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<RenewResult> {
  let response: Response;
  try {
    response = await authedFetch('/api/lease', { method: 'POST' });
  } catch (cause) {
    if (cause instanceof CloudError && cause.kind === 'refused') return { kind: 'signed-out' };
    return { kind: 'failed', detail: cause instanceof Error ? cause.message : String(cause) };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const jws = stringField(body, 'lease');
    return jws ? { kind: 'lease', jws } : { kind: 'failed', detail: 'a 200 without a lease' };
  }
  if (response.status === 403 && stringField(body, 'error') === 'lease_refused') {
    const reason = stringField(body, 'reason') as LapseReason | undefined;
    return { kind: 'refused', reason: reason && REASONS.includes(reason) ? reason : 'unknown' };
  }
  return { kind: 'failed', detail: `HTTP ${String(response.status)}` };
}
