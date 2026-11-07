import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChoosePlan } from '@features/account/hooks/use-choose-plan';

const openAccountWeb = vi.hoisted(() => vi.fn());
const watchPurchase = vi.hoisted(() => vi.fn());
vi.mock('@lib/account', () => ({ openAccountWeb }));
vi.mock('@lib/licence', () => ({ watchPurchase }));

describe('useChoosePlan', () => {
  beforeEach(() => {
    openAccountWeb.mockReset().mockResolvedValue({ ok: true });
    watchPurchase.mockReset().mockResolvedValue(undefined);
  });

  it('start opens /account/plan, watches, and waits', async () => {
    const { result } = renderHook(() => useChoosePlan());
    await act(async () => result.current.start());
    expect(openAccountWeb).toHaveBeenCalledWith('/account/plan');
    expect(watchPurchase).toHaveBeenCalledWith(true);
    expect(result.current.waiting).toBe(true);
  });

  it('cancel stops the watch', async () => {
    const { result } = renderHook(() => useChoosePlan());
    await act(async () => result.current.start());
    act(() => result.current.cancel());
    expect(watchPurchase).toHaveBeenLastCalledWith(false);
    expect(result.current.waiting).toBe(false);
  });

  it('an open that fails shows its error and never watches', async () => {
    openAccountWeb.mockResolvedValue({ error: "HiveTTY couldn't open that page. Try again." });
    const { result } = renderHook(() => useChoosePlan());
    await act(async () => result.current.start());
    expect(result.current).toMatchObject({ waiting: false, error: "HiveTTY couldn't open that page. Try again." });
    expect(watchPurchase).not.toHaveBeenCalledWith(true);
  });

  it('unmount stops the watch', async () => {
    const { result, unmount } = renderHook(() => useChoosePlan());
    await act(async () => result.current.start());
    unmount();
    expect(watchPurchase).toHaveBeenLastCalledWith(false);
  });
});
