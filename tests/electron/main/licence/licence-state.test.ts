// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountState } from '../../../../electron/shared/account-contract';
import type { RenewResult } from '../../../../electron/main/licence/lease';
import { createLicenceState } from '../../../../electron/main/licence/licence-state';
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
