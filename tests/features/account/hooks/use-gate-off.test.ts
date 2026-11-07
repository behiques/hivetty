import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useGateOff } from '@features/account/hooks/use-gate-off';

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useGateOff', () => {
  it('is true with no bridge, at once', () => {
    expect(renderHook(() => useGateOff()).result.current).toBe(true);
  });
  it('is null, then what appInfo says', async () => {
    (window as { hive?: unknown }).hive = { appInfo: () => Promise.resolve({ gateOff: true }) };
    const { result } = renderHook(() => useGateOff());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(true));
  });
  it('is false when appInfo has no gateOff, or fails', async () => {
    (window as { hive?: unknown }).hive = { appInfo: () => Promise.resolve({}) };
    const a = renderHook(() => useGateOff());
    await waitFor(() => expect(a.result.current).toBe(false));
    (window as { hive?: unknown }).hive = { appInfo: () => Promise.reject(new Error('x')) };
    const b = renderHook(() => useGateOff());
    await waitFor(() => expect(b.result.current).toBe(false));
  });
});
