import type { TrialResult } from '@shared/account-contract';

import { stringField } from './cloud';

/**
 * Start trial (HIVE-265 against HIVE-275's `POST /api/trial`). The app learns the trial is used only here: a 409
 * names why, and the gate hides Start trial. A 201 renews the lease at once, so the gate opens on its own.
 */
export async function startTrial(deps: {
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}): Promise<TrialResult> {
  let response: Response;
  try {
    response = await deps.authedFetch('/api/trial', { method: 'POST' });
  } catch {
    return { error: "Couldn't reach HiveTTY. Try again." };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 201) {
    await deps.refresh();
    return { ok: true };
  }
  const code = stringField(body, 'error');
  if (response.status === 409 && (code === 'trial_used' || code === 'already_subscribed')) return { error: code };
  if (response.status === 401) {
    // A revoked device was already signed out by authedFetch; any other 401 is an account the cloud no longer accepts.
    if (stringField(body, 'error_description') !== 'device_revoked') await deps.signOut();
    return { error: 'Sign in again.' };
  }
  return { error: "The trial didn't start. Try again." };
}
