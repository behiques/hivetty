import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCliDetection } from '@hooks/use-cli-detection';
import { detectClis, resetCliDetectionCache } from '@lib/cli-detection';

const one = { 'claude-code': { path: '/a', version: '1' }, codex: { missing: 'no' }, copilot: { missing: 'no' } };
const two = { ...one, codex: { path: '/b', version: '2' } };

const bridge = (cli: object) => {
  (window as unknown as { hive: unknown }).hive = { cli };
};

afterEach(() => {
  resetCliDetectionCache();
  delete (window as unknown as { hive?: unknown }).hive;
});

describe('useCliDetection (HIVE-375)', () => {
  it('reads, settles, and replaces the answer on rescan', async () => {
    bridge({ detect: vi.fn(async () => one), rescan: vi.fn(async () => two) });
    const { result } = renderHook(() => useCliDetection());
    expect(result.current.settled).toBe(false);
    expect(result.current.detection).toBeNull();
    await waitFor(() => expect(result.current.detection).toEqual(one));
    expect(result.current.settled).toBe(true);
    await act(() => result.current.rescan());
    expect(result.current.detection).toEqual(two);
    expect(result.current.rescanning).toBe(false);
  });

  it('a rescan from one caller reaches every mounted caller (HIVE-376)', async () => {
    bridge({ detect: vi.fn(async () => one), rescan: vi.fn(async () => two) });
    const page = renderHook(() => useCliDetection());
    const overview = renderHook(() => useCliDetection());
    await waitFor(() => expect(overview.result.current.detection).toEqual(one));
    await act(() => page.result.current.rescan());
    expect(overview.result.current.detection).toEqual(two);
  });

  it('starts on the last answer without reading again', async () => {
    const detect = vi.fn(async () => one);
    bridge({ detect });
    await detectClis();
    const { result } = renderHook(() => useCliDetection());
    expect(result.current).toMatchObject({ detection: one, settled: true });
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('drops an answer that lands after unmount', async () => {
    let answer!: (value: unknown) => void;
    bridge({ detect: () => new Promise((resolve) => (answer = resolve)) });
    const { result, unmount } = renderHook(() => useCliDetection());
    unmount();
    await act(async () => answer(one));
    expect(result.current.settled).toBe(false);
  });
});
