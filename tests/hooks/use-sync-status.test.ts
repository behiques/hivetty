import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSyncStatus } from '@/hooks/use-sync-status';

/** Settings sync's status for the Sync tab (HIVE-284): subscribe first, then read; a push is never overwritten. */

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useSyncStatus', () => {
  it('is null with no bridge', () => {
    expect(renderHook(() => useSyncStatus()).result.current).toBeNull();
  });

  it('hydrates from the read when nothing was pushed', async () => {
    (window as { hive?: unknown }).hive = {
      sync: {
        status: () => Promise.resolve({ kind: 'off', cloud: 'none', resetElsewhere: false }),
        onStatus: () => vi.fn(),
      },
    };
    const { result } = renderHook(() => useSyncStatus());
    await waitFor(() => expect(result.current).toEqual({ kind: 'off', cloud: 'none', resetElsewhere: false }));
  });

  it('a push before the read lands wins, and later pushes follow', async () => {
    let push!: (s: unknown) => void;
    let resolveRead!: (s: unknown) => void;
    const unsubscribe = vi.fn();
    (window as { hive?: unknown }).hive = {
      sync: {
        status: () =>
          new Promise((r) => {
            resolveRead = r;
          }),
        onStatus: (cb: (s: unknown) => void) => {
          push = cb;
          return unsubscribe;
        },
      },
    };
    const { result, unmount } = renderHook(() => useSyncStatus());
    act(() => push({ kind: 'unavailable', reason: 'locked' }));
    await act(async () => resolveRead({ kind: 'off', cloud: 'none', resetElsewhere: false }));
    expect(result.current).toEqual({ kind: 'unavailable', reason: 'locked' });
    act(() => push({ kind: 'unavailable', reason: 'signed-out' }));
    expect(result.current).toEqual({ kind: 'unavailable', reason: 'signed-out' });
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
