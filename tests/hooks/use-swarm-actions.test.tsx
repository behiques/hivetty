import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSwarmActions } from '@hooks/use-swarm-actions';
import { useUiStore } from '@stores/ui-store';

const account = vi.hoisted(() => ({ signIn: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@lib/account', () => account);

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.getState().reset();
});

describe('useSwarmActions (HIVE-447)', () => {
  it('install(id) sets the install request and opens Settings on Swarms', () => {
    const { result } = renderHook(() => useSwarmActions());

    act(() => result.current.install('std1'));

    expect(useUiStore.getState().swarmInstallRequest).toBe('std1');
    expect(useUiStore.getState().swarmsBrowseRequest).toBe(false);
    expect(useUiStore.getState().settings).toBe(true);
    expect(useUiStore.getState().settingsSection).toBe('swarms');
    expect(account.signIn).not.toHaveBeenCalled();
  });

  it('install(null) signs in and does nothing else', () => {
    const { result } = renderHook(() => useSwarmActions());

    act(() => result.current.install(null));

    expect(account.signIn).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().swarmInstallRequest).toBeNull();
    expect(useUiStore.getState().settings).toBe(false);
  });

  it('browse() sets the browse request and opens Settings on Swarms', () => {
    const { result } = renderHook(() => useSwarmActions());

    act(() => result.current.browse());

    expect(useUiStore.getState().swarmsBrowseRequest).toBe(true);
    expect(useUiStore.getState().swarmInstallRequest).toBeNull();
    expect(useUiStore.getState().settings).toBe(true);
    expect(useUiStore.getState().settingsSection).toBe('swarms');
    expect(account.signIn).not.toHaveBeenCalled();
  });
});
