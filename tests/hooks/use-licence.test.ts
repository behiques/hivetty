import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLicence } from '@/hooks/use-licence';

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useLicence', () => {
  it('is null with no bridge', () => {
    expect(renderHook(() => useLicence()).result.current).toBeNull();
  });

  it('hydrates from the read when nothing was pushed', async () => {
    (window as { hive?: unknown }).hive = {
      licence: {
        state: () => Promise.resolve({ kind: 'unlicensed' }),
        onChanged: () => vi.fn(),
      },
    };
    const { result } = renderHook(() => useLicence());
    await waitFor(() => expect(result.current).toEqual({ kind: 'unlicensed' }));
  });

  it('hydrates, then follows pushes; a push before the read lands wins', async () => {
    let push!: (s: unknown) => void;
    let resolveRead!: (s: unknown) => void;
    (window as { hive?: unknown }).hive = {
      licence: {
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
    const { result } = renderHook(() => useLicence());
    act(() => push({ kind: 'lapsed', reason: 'offline' }));
    await act(async () => resolveRead({ kind: 'unlicensed' }));
    await waitFor(() => expect(result.current).toEqual({ kind: 'lapsed', reason: 'offline' }));
  });

  it('unsubscribes on unmount', () => {
    const dispose = vi.fn();
    (window as { hive?: unknown }).hive = {
      licence: { state: () => new Promise(() => undefined), onChanged: () => dispose },
    };
    renderHook(() => useLicence()).unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
