import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSwarmInstallLink } from '@hooks/use-swarm-install-link';
import { useUiStore } from '@stores/ui-store';

let pending: (string | null)[] = [];
let push: () => void = () => undefined;
let takeInstallRequest: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useUiStore.getState().reset();
  pending = [];
  unsubscribe = vi.fn();
  takeInstallRequest = vi.fn(() => Promise.resolve(pending.shift() ?? null));
  window.hive = {
    swarms: {
      takeInstallRequest,
      onInstallRequested: vi.fn((callback: () => void) => {
        push = callback;
        return unsubscribe;
      }),
    },
  } as unknown as Window['hive'];
});

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useSwarmInstallLink (HIVE-442)', () => {
  it('takes a pending request on mount and opens Settings on Swarms', async () => {
    pending = ['a1'];
    renderHook(() => useSwarmInstallLink());

    await waitFor(() => expect(useUiStore.getState().swarmInstallRequest).toBe('a1'));
    expect(useUiStore.getState().settings).toBe(true);
    expect(useUiStore.getState().settingsSection).toBe('swarms');
  });

  it('takes again on every push', async () => {
    renderHook(() => useSwarmInstallLink());
    await waitFor(() => expect(takeInstallRequest).toHaveBeenCalledTimes(1));

    pending = ['b2'];
    push();

    await waitFor(() => expect(useUiStore.getState().swarmInstallRequest).toBe('b2'));
    expect(takeInstallRequest).toHaveBeenCalledTimes(2);
  });

  it('changes nothing when there is no request', async () => {
    renderHook(() => useSwarmInstallLink());

    await waitFor(() => expect(takeInstallRequest).toHaveBeenCalledTimes(1));
    expect(useUiStore.getState().swarmInstallRequest).toBeNull();
    expect(useUiStore.getState().settings).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useSwarmInstallLink());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does nothing with no bridge', () => {
    delete (window as { hive?: unknown }).hive;
    expect(() => renderHook(() => useSwarmInstallLink())).not.toThrow();
    expect(useUiStore.getState().settings).toBe(false);
  });
});
