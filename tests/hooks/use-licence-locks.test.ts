import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLicenceLocks } from '@hooks/use-licence-locks';

const SOLO = {
  kind: 'licensed',
  plan: 'solo',
  features: ['cli.codex'],
  limits: {},
  exp: 2_000_000_000,
  iat: 1_800_000_000,
};
const bridge = (gateOff: boolean) => ({
  appInfo: () => Promise.resolve(gateOff ? { gateOff: true } : {}),
  licence: { state: () => Promise.resolve(SOLO), onChanged: () => vi.fn() },
});

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useLicenceLocks (HIVE-332)', () => {
  it('locks nothing with no bridge (the browser), settled at once', async () => {
    const { result } = renderHook(() => useLicenceLocks());
    await waitFor(() => expect(result.current).toEqual({ licence: null, settled: true }));
  });

  it('hands over the licence once read with the gate on', async () => {
    (window as { hive?: unknown }).hive = bridge(false);
    const { result } = renderHook(() => useLicenceLocks());
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current).toEqual({ licence: SOLO, settled: true }));
  });

  it('locks nothing with the e2e gate off', async () => {
    (window as { hive?: unknown }).hive = bridge(true);
    const { result } = renderHook(() => useLicenceLocks());
    await waitFor(() => expect(result.current).toEqual({ licence: null, settled: true }));
  });
});
