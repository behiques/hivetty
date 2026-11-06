// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountState } from '../../../../electron/shared/account-contract';
import type { RenewResult } from '../../../../electron/main/licence/lease';
import {
  createLicenceState,
  GRACE_RETRY_MS,
  PURCHASE_POLL_MS,
  PURCHASE_WATCH_MS,
  RENEW_EVERY_MS,
} from '../../../../electron/main/licence/licence-state';
import { claimsFor, DEVICE, ISS, makeSigner, NOW_S } from '../../../support/lease';

const signer = makeSigner('kid-1');
const SIGNED_IN: AccountState = { kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: DEVICE };

function harness(opts: { stored?: string | null; account?: AccountState; renew?: RenewResult[] } = {}) {
  let account = opts.account ?? SIGNED_IN;
  const listeners = new Set<(state: AccountState) => void>();
  let stored = opts.stored ?? null;
  const results = [...(opts.renew ?? [])];
  const renew = vi.fn(async (): Promise<RenewResult> => results.shift() ?? { kind: 'failed', detail: 'offline' });
  const machine = createLicenceState({
    account: {
      state: () => account,
      onChange: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    file: {
      read: () => stored,
      write: (jws) => {
        stored = jws;
      },
    },
    renew,
    keys: [signer.jwk],
    iss: ISS,
    now: () => Date.now(),
  });
  const setAccount = (next: AccountState) => {
    account = next;
    for (const l of listeners) l(next);
  };
  /** Changes what `account.state()` answers without telling the listeners, as a mid-renewal sign-in does. */
  const swapAccount = (next: AccountState) => {
    account = next;
  };
  return { machine, renew, setAccount, swapAccount, stored: () => stored };
}

const terms = (overrides = {}) => ({
  plan: 'team',
  features: ['agents'],
  limits: { sessions: 10 },
  exp: NOW_S + 7 * 86_400,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_S * 1000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('licence state at launch', () => {
  it('is unlicensed with no lease, and with a lease that fails verification', () => {
    for (const stored of [null, 'a.b.c', makeSigner('kid-x').sign(claimsFor())]) {
      const { machine } = harness({ stored });
      machine.start();
      expect(machine.state()).toEqual({ kind: 'unlicensed' });
    }
  });

  it('is licensed with a valid lease, before any network', () => {
    const { machine } = harness({ stored: signer.sign(claimsFor()) });
    machine.start();
    expect(machine.state()).toEqual({ kind: 'licensed', ...terms() });
  });

  it('is lapsed {offline} with a lease that has only expired', () => {
    const { machine } = harness({ stored: signer.sign(claimsFor({ exp: NOW_S - 1 })) });
    machine.start();
    expect(machine.state()).toEqual({ kind: 'lapsed', reason: 'offline' });
  });

  it('is lapsed {signed_out} when signed out with a lease on file, skipping the device check', () => {
    const { machine } = harness({
      stored: signer.sign(claimsFor({ device: 'other' })),
      account: { kind: 'signed-out' },
    });
    machine.start();
    expect(machine.state()).toEqual({ kind: 'lapsed', reason: 'signed_out' });
  });

  it('renews on start, and a launch with no network moves licensed to grace with no prompt', async () => {
    const { machine, renew } = harness({ stored: signer.sign(claimsFor()) });
    machine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(machine.state()).toEqual({ kind: 'grace', ...terms() });
  });

  it('does not renew while signed out', async () => {
    const { machine, renew } = harness({ account: { kind: 'signed-out' } });
    machine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).not.toHaveBeenCalled();
  });

  it('notifies listeners only on a change, and start is idempotent', async () => {
    const { machine, renew } = harness({ stored: signer.sign(claimsFor()) });
    const seen: string[] = [];
    machine.onChange((s) => seen.push(s.kind));
    machine.start();
    machine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['licensed', 'grace']);
    expect(renew).toHaveBeenCalledTimes(1);
  });
});

describe('a renewal that finds no token mid sign-in (Task 4 review)', () => {
  it('is grace while the lease holds, not lapsed {signed_out}', async () => {
    const h = harness({ stored: signer.sign(claimsFor()) });
    let release!: (r: RenewResult) => void;
    h.renew.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    h.machine.start();
    // The user clicks Sign in while this renewal's token refresh is still out; authedFetch then throws
    // `refused` because the account reads signing-in, and renewLease answers signed-out.
    h.swapAccount({ kind: 'signing-in' });
    release({ kind: 'signed-out' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.machine.state()).toEqual({ kind: 'grace', ...terms() });
  });
});

describe('licence state transitions', () => {
  const started = async (opts: Parameters<typeof harness>[0]) => {
    const h = harness(opts);
    h.machine.start();
    await vi.advanceTimersByTimeAsync(0);
    return h;
  };

  it('a renewed lease replaces lease.jws and is licensed', async () => {
    const fresh = signer.sign(claimsFor({ jti: 'ls_2', exp: NOW_S + 30 * 86_400 }));
    const h = await started({ stored: signer.sign(claimsFor()), renew: [{ kind: 'lease', jws: fresh }] });
    expect(h.stored()).toBe(fresh);
    expect(h.machine.state()).toEqual({ kind: 'licensed', ...terms({ exp: NOW_S + 30 * 86_400 }) });
  });

  it('a refusal lapses at once, even with days left on the lease', async () => {
    const h = await started({
      stored: signer.sign(claimsFor()),
      renew: [{ kind: 'refused', reason: 'payment_failed' }],
    });
    expect(h.machine.state()).toEqual({ kind: 'lapsed', reason: 'payment_failed' });
  });

  it('a renewed lease that does not verify is a failure, not a licence', async () => {
    const forged = makeSigner('kid-x').sign(claimsFor());
    const h = await started({ stored: signer.sign(claimsFor()), renew: [{ kind: 'lease', jws: forged }] });
    expect(h.stored()).not.toBe(forged);
    expect(h.machine.state().kind).toBe('grace');
  });

  it('an expired lease renewed on launch is licensed again', async () => {
    const h = await started({
      stored: signer.sign(claimsFor({ exp: NOW_S - 1 })),
      renew: [{ kind: 'lease', jws: signer.sign(claimsFor({ jti: 'ls_3' })) }],
    });
    expect(h.machine.state().kind).toBe('licensed');
  });

  it('a device_revoked sign-out lapses {device_revoked}; any other sign-out with a lease, {signed_out}', async () => {
    const a = await started({ stored: signer.sign(claimsFor()) });
    a.setAccount({ kind: 'signed-out', reason: 'device-revoked' });
    expect(a.machine.state()).toEqual({ kind: 'lapsed', reason: 'device_revoked' });

    const b = await started({ stored: signer.sign(claimsFor()) });
    b.setAccount({ kind: 'signed-out' });
    expect(b.machine.state()).toEqual({ kind: 'lapsed', reason: 'signed_out' });
  });

  it('a sign-out with no lease is unlicensed, and a sign-in renews', async () => {
    const h = await started({ account: { kind: 'signed-out' } });
    h.setAccount({ kind: 'signed-out' });
    expect(h.machine.state()).toEqual({ kind: 'unlicensed' });
    h.setAccount(SIGNED_IN);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.renew).toHaveBeenCalledTimes(1);
  });

  it('a renewal that finds no token reads the file again', async () => {
    const h = await started({ stored: signer.sign(claimsFor()), renew: [{ kind: 'signed-out' }] });
    expect(h.machine.state().kind).toBe('licensed');
  });

  it('a renew that throws is a failure', async () => {
    const h = harness({ stored: signer.sign(claimsFor()) });
    h.renew.mockRejectedValueOnce(new Error('boom'));
    h.machine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.machine.state().kind).toBe('grace');
  });
});

describe('licence clocks', () => {
  it('renews every 24 h, and each new lease replaces lease.jws', async () => {
    const leases = [1, 2, 3].map((n) => signer.sign(claimsFor({ jti: `ls_${String(n)}` })));
    const h = harness({
      stored: signer.sign(claimsFor()),
      renew: leases.map((jws) => ({ kind: 'lease', jws }) as const),
    });
    h.machine.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS);
    await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS);
    expect(h.renew).toHaveBeenCalledTimes(3);
    expect(h.stored()).toBe(leases[2]);
  });

  it('a lease expiring while offline moves grace to lapsed {offline}', async () => {
    const h = harness({ stored: signer.sign(claimsFor({ exp: NOW_S + 3600 })) });
    h.machine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.machine.state().kind).toBe('grace');
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(h.machine.state()).toEqual({ kind: 'lapsed', reason: 'offline' });
  });

  it('a 30-day lease lapses on day 30, not early (no setTimeout overflow)', async () => {
    const h = harness({ stored: signer.sign(claimsFor({ exp: NOW_S + 30 * 86_400 })) });
    h.machine.start();
    await vi.advanceTimersByTimeAsync(29 * 86_400_000);
    expect(h.machine.state().kind).toBe('grace');
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(h.machine.state()).toEqual({ kind: 'lapsed', reason: 'offline' });
  });

  it('grace retries every 5 min, and stops once licensed', async () => {
    const h = harness({ stored: signer.sign(claimsFor()) });
    h.machine.start();
    await vi.advanceTimersByTimeAsync(0);
    h.renew.mockResolvedValueOnce({ kind: 'lease', jws: signer.sign(claimsFor({ jti: 'ls_9' })) });
    await vi.advanceTimersByTimeAsync(GRACE_RETRY_MS);
    expect(h.machine.state().kind).toBe('licensed');
    const calls = h.renew.mock.calls.length;
    await vi.advanceTimersByTimeAsync(GRACE_RETRY_MS * 3);
    expect(h.renew.mock.calls.length).toBe(calls);
  });

  it('joins a renewal already in flight', async () => {
    const h = harness({ stored: signer.sign(claimsFor()) });
    let release!: (r: RenewResult) => void;
    h.renew.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    h.machine.start();
    const a = h.machine.refresh();
    const b = h.machine.refresh();
    release({ kind: 'refused', reason: 'trial_ended' });
    await expect(Promise.all([a, b])).resolves.toEqual([
      { kind: 'lapsed', reason: 'trial_ended' },
      { kind: 'lapsed', reason: 'trial_ended' },
    ]);
    expect(h.renew).toHaveBeenCalledTimes(1);
  });

  it('keeps renewing after a refusal, so a fixed payment comes back', async () => {
    const h = harness({
      stored: signer.sign(claimsFor()),
      renew: [{ kind: 'refused', reason: 'payment_failed' }],
    });
    h.machine.start();
    await vi.advanceTimersByTimeAsync(0);
    h.renew.mockResolvedValueOnce({ kind: 'lease', jws: signer.sign(claimsFor({ jti: 'ls_4' })) });
    await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS);
    expect(h.machine.state().kind).toBe('licensed');
  });

  it('watchPurchase polls every 5 s until licensed', async () => {
    const h = harness({ account: SIGNED_IN, renew: [{ kind: 'refused', reason: 'no_plan' }] });
    h.machine.start();
    await vi.advanceTimersByTimeAsync(0);
    h.machine.watchPurchase(true);
    await vi.advanceTimersByTimeAsync(PURCHASE_POLL_MS * 2);
    expect(h.renew).toHaveBeenCalledTimes(3);
    h.renew.mockResolvedValueOnce({ kind: 'lease', jws: signer.sign(claimsFor({ jti: 'ls_5' })) });
    await vi.advanceTimersByTimeAsync(PURCHASE_POLL_MS);
    expect(h.machine.state().kind).toBe('licensed');
    const calls = h.renew.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PURCHASE_POLL_MS * 4);
    expect(h.renew.mock.calls.length).toBe(calls);
  });

  it('watchPurchase gives up after 15 min, and watchPurchase(false) stops it', async () => {
    const h = harness({ account: SIGNED_IN });
    h.machine.start();
    h.machine.watchPurchase(true);
    await vi.advanceTimersByTimeAsync(PURCHASE_WATCH_MS + PURCHASE_POLL_MS);
    const calls = h.renew.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PURCHASE_POLL_MS * 4);
    // Only the 5-min grace retry may still fire; the 5 s poll must not.
    expect(h.renew.mock.calls.length - calls).toBeLessThanOrEqual(1);
    h.machine.watchPurchase(true);
    h.machine.watchPurchase(false);
    const after = h.renew.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PURCHASE_POLL_MS * 2);
    expect(h.renew.mock.calls.length).toBe(after);
  });

  it('dispose stops every clock', async () => {
    const h = harness({ stored: signer.sign(claimsFor()) });
    h.machine.start();
    await vi.advanceTimersByTimeAsync(0);
    h.machine.dispose();
    await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS * 2);
    expect(h.renew).toHaveBeenCalledTimes(1);
  });
});
