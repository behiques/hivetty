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
  const post = async (): Promise<{ response: Response; body: unknown } | null> => {
    try {
      const response = await deps.authedFetch('/api/trial', { method: 'POST' });
      return { response, body: await response.json().catch(() => null) };
    } catch {
      return null;
    }
  };
  const revoked = (body: unknown) => stringField(body, 'error_description') === 'device_revoked';

  let answer = await post();
  // authedFetch reads a plain 401 as an expired access token and drops it, so one retry carries a fresh one. A
  // revoked device was already signed out by authedFetch and is not retried.
  if (answer?.response.status === 401 && !revoked(answer.body)) answer = await post();
  if (!answer) return { error: "Couldn't reach HiveTTY. Try again." };
  const { response, body } = answer;
  if (response.status === 201) {
    await deps.refresh();
    return { ok: true };
  }
  const code = stringField(body, 'error');
  if (response.status === 409 && (code === 'trial_used' || code === 'already_subscribed')) return { error: code };
  if (response.status === 401) {
    // A second invalid_token after a fresh token is an account the cloud no longer accepts (HIVE-275's inactive user).
    if (code === 'invalid_token' && !revoked(body)) await deps.signOut();
    return { error: 'Sign in again.' };
  }
  return { error: "The trial didn't start. Try again." };
}
