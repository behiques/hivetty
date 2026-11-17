import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEntitlement } from '@/hooks/use-entitlement';

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

const lease = (features: string[]) => ({ kind: 'licensed', plan: 'solo', features, limits: {}, exp: 2_000_000_000, iat: 1_800_000_000 });

/** The app with the licence gate on: main's appInfo says gateOff false (HIVE-265 ruling 4). */
const gated = (licence: Record<string, unknown>): void => {
  (window as { hive?: unknown }).hive = { appInfo: () => Promise.resolve({ gateOff: false }), licence };
};

describe('useEntitlement', () => {
  it('locks nothing with no bridge: the browser target has no gate (HIVE-429)', () => {
    expect(renderHook(() => useEntitlement('relay')).result.current).toEqual({ allowed: true });
  });

  it('locks nothing when main says the gate is off, whatever the lease says (HIVE-429)', async () => {
    (window as { hive?: unknown }).hive = {
      appInfo: () => Promise.resolve({ gateOff: true }),
      licence: { state: () => Promise.resolve(lease([])), onChanged: () => vi.fn() },
    };
    const { result } = renderHook(() => useEntitlement('relay'));
    await act(async () => undefined);
    expect(result.current).toEqual({ allowed: true });
  });

  it('locks nothing before the licence is read (HIVE-429)', () => {
    gated({ state: () => new Promise(() => undefined), onChanged: () => vi.fn() });
    expect(renderHook(() => useEntitlement('relay')).result.current).toEqual({ allowed: true });
  });

  it('with the gate on, answers the reason and the upgrade path for a plan without the feature', async () => {
    gated({ state: () => Promise.resolve({ kind: 'licensed', plan: 'free', features: [], limits: {}, exp: 2_000_000_000, iat: 1_800_000_000 }), onChanged: () => vi.fn() });
    const { result } = renderHook(() => useEntitlement('relay'));
    await waitFor(() =>
      expect(result.current).toEqual({
        allowed: false,
        reason: expect.stringContaining('Relay'),
        plan: 'Solo',
        upgradeUrl: '/account/plan',
      }),
    );
  });

  it('follows a new lease with no reload', async () => {
    let push!: (s: unknown) => void;
    gated({
      state: () => Promise.resolve(lease(['cli.codex'])),
      onChanged: (cb: (s: unknown) => void) => {
        push = cb;
        return vi.fn();
      },
    });
    const { result } = renderHook(() => useEntitlement('cli.copilot'));
    await waitFor(() => expect(result.current).toMatchObject({ allowed: false, reason: 'Copilot is in Team and above' }));
    act(() => push(lease(['cli.codex', 'cli.copilot'])));
    expect(result.current).toEqual({ allowed: true });
  });
});
