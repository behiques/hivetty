// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { startTrial } from '../../../../electron/main/licence/trial';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function setup(answer: Response | Error) {
  const authedFetch = vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
  const refresh = vi.fn().mockResolvedValue(undefined);
  const signOut = vi.fn().mockResolvedValue(undefined);
  return { deps: { authedFetch, refresh, signOut }, authedFetch, refresh, signOut };
}

describe('startTrial (HIVE-265, HIVE-275)', () => {
  it('201: POSTs /api/trial, renews the lease, answers ok', async () => {
    const { deps, authedFetch, refresh } = setup(json(201, { trialEnds: '2026-11-21T00:00:00.000Z' }));
    await expect(startTrial(deps)).resolves.toEqual({ ok: true });
    expect(authedFetch).toHaveBeenCalledWith('/api/trial', { method: 'POST' });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each(['trial_used', 'already_subscribed'])('409 %s answers that code, with no renewal', async (code) => {
    const { deps, refresh } = setup(json(409, { error: code }));
    await expect(startTrial(deps)).resolves.toEqual({ error: code });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('401 invalid_token signs out', async () => {
    const { deps, signOut } = setup(json(401, { error: 'invalid_token' }));
    await expect(startTrial(deps)).resolves.toEqual({ error: 'Sign in again.' });
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('401 device_revoked leaves the sign-out to authedFetch', async () => {
    const { deps, signOut } = setup(json(401, { error: 'invalid_token', error_description: 'device_revoked' }));
    await expect(startTrial(deps)).resolves.toEqual({ error: 'Sign in again.' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('a network failure is one sentence', async () => {
    const { deps } = setup(new Error('offline'));
    await expect(startTrial(deps)).resolves.toEqual({ error: "Couldn't reach HiveTTY. Try again." });
  });

  it('anything else is one sentence', async () => {
    const { deps } = setup(json(500, {}));
    await expect(startTrial(deps)).resolves.toEqual({ error: "The trial didn't start. Try again." });
  });
});
