import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAccount } from '@/hooks/use-account';

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useAccount', () => {
  it('is null with no bridge', () => {
    expect(renderHook(() => useAccount()).result.current).toBeNull();
  });

  it('hydrates from the read when nothing was pushed', async () => {
    (window as { hive?: unknown }).hive = {
      account: {
        state: () => Promise.resolve({ kind: 'signed-out' }),
        onChanged: () => vi.fn(),
      },
    };
    const { result } = renderHook(() => useAccount());
    await waitFor(() => expect(result.current).toEqual({ kind: 'signed-out' }));
  });

  it('hydrates, then follows pushes; a push before the read lands wins', async () => {
    let push!: (s: unknown) => void;
    let resolveRead!: (s: unknown) => void;
    (window as { hive?: unknown }).hive = {
      account: {
        state: () =>
          new Promise((r) => {
            resolveRead = r;
          }),
        onChanged: (cb: (s: unknown) => void) => {
          push = cb;
          return vi.fn();
        },
      },
    };
    const { result } = renderHook(() => useAccount());
    act(() => push({ kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: 'd' }));
    await act(async () => resolveRead({ kind: 'signed-out' }));
    await waitFor(() => expect(result.current).toEqual({ kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: 'd' }));
  });

  it('unsubscribes on unmount', () => {
    const dispose = vi.fn();
    (window as { hive?: unknown }).hive = {
      account: { state: () => new Promise(() => undefined), onChanged: () => dispose },
    };
    renderHook(() => useAccount()).unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
