import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRelayStatusChanged, readRelayStatus } from '@/lib/relay';

const bridge = (relay: Record<string, unknown>): void => {
  (window as { hive?: unknown }).hive = { relay };
};

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
  vi.restoreAllMocks();
});

describe('src/lib/relay', () => {
  it('answers off and a no-op unsubscribe with no bridge (the browser target)', async () => {
    await expect(readRelayStatus()).resolves.toEqual({ state: 'off' });
    const unsubscribe = onRelayStatusChanged(vi.fn());
    expect(unsubscribe).toEqual(expect.any(Function));
    expect(() => unsubscribe()).not.toThrow();
  });

  it('passes main answers through', async () => {
    const dispose = vi.fn();
    const relay = {
      status: vi.fn().mockResolvedValue({ state: 'connected', since: 1 }),
      onStatus: vi.fn().mockReturnValue(dispose),
    };
    bridge(relay);
    await expect(readRelayStatus()).resolves.toEqual({ state: 'connected', since: 1 });
    const callback = vi.fn();
    expect(onRelayStatusChanged(callback)).toBe(dispose);
    expect(relay.onStatus).toHaveBeenCalledWith(callback);
  });

  it('answers off rather than throwing when main refuses', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({ status: vi.fn().mockRejectedValue(new Error('no handler')), onStatus: vi.fn() });
    await expect(readRelayStatus()).resolves.toEqual({ state: 'off' });
    expect(error).toHaveBeenCalled();
  });
});
