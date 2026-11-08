import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ORGS_REFRESH_MS, refreshOrgs, resetOrgs, useActiveOrg, useOrgs } from '@/hooks/use-orgs';

const SOLO = { id: 'org-me', name: 'Personal', role: 'Owner', seat: true, plan: 'solo', status: 'active', personal: true };
const ACME = { id: 'org-acme', name: 'Acme', role: 'Admin', seat: true, plan: 'team', status: 'active', personal: false };
const IN = { kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: 'd' };
const LEASE = { kind: 'licensed', org: 'org-acme', plan: 'team', features: [], limits: {}, exp: 2e9, iat: 1.9e9 };
const T0 = new Date('2026-11-08T12:00:00Z').getTime();

function bridge(account: unknown = IN, licence: unknown = LEASE) {
  const orgs = vi.fn(() => Promise.resolve([SOLO, ACME]));
  let push: (state: unknown) => void = () => undefined;
  (window as { hive?: unknown }).hive = {
    account: {
      state: () => Promise.resolve(account),
      onChanged: (callback: (state: unknown) => void) => {
        push = callback;
        return () => undefined;
      },
      orgs,
    },
    licence: { state: () => Promise.resolve(licence), onChanged: () => () => undefined },
  };
  return { orgs, push: (state: unknown) => push(state) };
}

beforeEach(() => {
  // Only Date: testing-library's waitFor needs real timers. The clock stands still until the test moves it.
  vi.useFakeTimers({ toFake: ['Date'], now: T0 });
  resetOrgs();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as { hive?: unknown }).hive;
});

describe('useOrgs (HIVE-291)', () => {
  it('is empty with no bridge, and refreshOrgs publishes nothing', async () => {
    const { result } = renderHook(() => useOrgs());
    refreshOrgs();
    await act(async () => undefined);
    expect(result.current).toEqual([]);
  });

  it('fetches once signed in, and every consumer shares the one list', async () => {
    const h = bridge();
    const first = renderHook(() => useOrgs());
    await waitFor(() => expect(first.result.current).toEqual([SOLO, ACME]));
    const second = renderHook(() => useOrgs());
    await waitFor(() => expect(second.result.current).toEqual([SOLO, ACME]));
    expect(h.orgs).toHaveBeenCalledTimes(1);
  });

  it('refreshOrgs asks again at most once a minute', async () => {
    const h = bridge();
    renderHook(() => useOrgs());
    await waitFor(() => expect(h.orgs).toHaveBeenCalledTimes(1));
    vi.setSystemTime(T0 + ORGS_REFRESH_MS - 1);
    refreshOrgs();
    expect(h.orgs).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + ORGS_REFRESH_MS);
    refreshOrgs();
    expect(h.orgs).toHaveBeenCalledTimes(2);
  });

  it('a sign-out empties it and forgets, so the next sign-in fetches at once', async () => {
    const h = bridge();
    const { result } = renderHook(() => useOrgs());
    await waitFor(() => expect(result.current).toEqual([SOLO, ACME]));
    act(() => h.push({ kind: 'signed-out' }));
    expect(result.current).toEqual([]);
    act(() => h.push(IN));
    await waitFor(() => expect(h.orgs).toHaveBeenCalledTimes(2));
  });

  it('is empty, and asks nothing, while signed out', async () => {
    const h = bridge({ kind: 'signed-out' });
    const { result } = renderHook(() => useOrgs());
    await act(async () => undefined);
    expect(result.current).toEqual([]);
    expect(h.orgs).not.toHaveBeenCalled();
  });
});

describe('useActiveOrg (HIVE-291)', () => {
  it("is the org whose id is the licence's org", async () => {
    bridge();
    const { result } = renderHook(() => useActiveOrg());
    await waitFor(() => expect(result.current).toEqual(ACME));
  });

  it('is undefined with no live licence', async () => {
    const h = bridge(IN, { kind: 'lapsed', reason: 'no_plan' });
    const { result } = renderHook(() => useActiveOrg());
    await waitFor(() => expect(h.orgs).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current).toBeUndefined();
  });
});
