import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostLicence } from '@shared/licence-contract';

import { useHostLicence } from '@features/account/hooks/use-host-licence';

const link = vi.hoisted(() => ({ current: null as { state: string; epoch: number; serverName: string } | null }));
vi.mock('@stores/hive-store', () => ({ useRemoteLink: () => link.current }));

const LAPSED: HostLicence = { lapsed: true, paused: { sessions: 2, agents: 1 } };
const FINE: HostLicence = { lapsed: false, paused: { sessions: 0, agents: 0 } };

let push: ((state: HostLicence) => void) | null;
let unsubscribe: ReturnType<typeof vi.fn>;
let licence: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = null;
  unsubscribe = vi.fn();
  licence = vi.fn(() => Promise.resolve(FINE));
  (window as { hive?: unknown }).hive = {
    server: {
      licence,
      onLicence: vi.fn((callback: (state: HostLicence) => void) => {
        push = callback;
        return unsubscribe;
      }),
    },
  };
  link.current = null;
});

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useHostLicence (HIVE-265)', () => {
  it('local: null, and never asks', () => {
    const { result } = renderHook(() => useHostLicence());
    expect(result.current).toBeNull();
    expect(licence).not.toHaveBeenCalled();
  });

  it('attached: reads, then follows the relayed push', async () => {
    link.current = { state: 'attached', epoch: 1, serverName: 'studio-mac' };
    const { result } = renderHook(() => useHostLicence());
    await waitFor(() => expect(result.current).toEqual(FINE));
    act(() => push?.(LAPSED));
    expect(result.current).toEqual(LAPSED);
  });

  it('a push before the read lands wins', async () => {
    let resolve: (value: HostLicence) => void = () => undefined;
    licence.mockReturnValue(new Promise<HostLicence>((r) => (resolve = r)));
    link.current = { state: 'attached', epoch: 1, serverName: 'studio-mac' };
    const { result } = renderHook(() => useHostLicence());
    act(() => push?.(LAPSED));
    await act(async () => {
      resolve(FINE);
      await Promise.resolve();
    });
    expect(result.current).toEqual(LAPSED);
  });

  it('a new epoch reads again', async () => {
    link.current = { state: 'attached', epoch: 1, serverName: 'studio-mac' };
    const { result, rerender } = renderHook(() => useHostLicence());
    await waitFor(() => expect(result.current).toEqual(FINE));
    licence.mockReturnValue(Promise.resolve(LAPSED));
    link.current = { state: 'attached', epoch: 2, serverName: 'studio-mac' };
    rerender();
    await waitFor(() => expect(result.current).toEqual(LAPSED));
    expect(licence).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('back to local: null, and unsubscribed', async () => {
    link.current = { state: 'attached', epoch: 1, serverName: 'studio-mac' };
    const { result, rerender } = renderHook(() => useHostLicence());
    await waitFor(() => expect(result.current).toEqual(FINE));
    link.current = null;
    rerender();
    expect(result.current).toBeNull();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('a failed read leaves it null', async () => {
    licence.mockReturnValue(Promise.reject(new Error('refused')));
    link.current = { state: 'attached', epoch: 1, serverName: 'studio-mac' };
    const { result } = renderHook(() => useHostLicence());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBeNull();
  });
});
