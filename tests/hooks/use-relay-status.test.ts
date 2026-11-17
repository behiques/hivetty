import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRelayStatus } from '@/hooks/use-relay-status';

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useRelayStatus', () => {
  it('starts at off, and stays there with no bridge', async () => {
    const { result } = renderHook(() => useRelayStatus());
    expect(result.current).toEqual({ state: 'off' });
    await act(async () => undefined);
    expect(result.current).toEqual({ state: 'off' });
  });

  it('reads once when nothing was pushed', async () => {
    const status = vi.fn(() => Promise.resolve({ state: 'pending-launch' }));
    (window as { hive?: unknown }).hive = { relay: { status, onStatus: () => vi.fn() } };
    const { result } = renderHook(() => useRelayStatus());
    await waitFor(() => expect(result.current).toEqual({ state: 'pending-launch' }));
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('follows pushes, and a push before the read lands wins', async () => {
    let push!: (s: unknown) => void;
    let resolveRead!: (s: unknown) => void;
    (window as { hive?: unknown }).hive = {
      relay: {
        status: () =>
          new Promise((r) => {
            resolveRead = r;
          }),
        onStatus: (cb: (s: unknown) => void) => {
          push = cb;
          return vi.fn();
        },
      },
    };
    const { result } = renderHook(() => useRelayStatus());
    act(() => push({ state: 'connecting' }));
    await act(async () => resolveRead({ state: 'off' }));
    expect(result.current).toEqual({ state: 'connecting' });
    act(() => push({ state: 'connected', since: 9 }));
    expect(result.current).toEqual({ state: 'connected', since: 9 });
  });

  it('unsubscribes on unmount', () => {
    const dispose = vi.fn();
    (window as { hive?: unknown }).hive = {
      relay: { status: () => new Promise(() => undefined), onStatus: () => dispose },
    };
    renderHook(() => useRelayStatus()).unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
