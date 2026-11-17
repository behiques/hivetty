import { afterEach, describe, expect, it, vi } from 'vitest';

import { listRelayHosts, onRelayStatusChanged, readRelayStatus } from '@/lib/relay';

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

  it('lists no servers, unavailable, with no bridge (HIVE-429)', async () => {
    await expect(listRelayHosts()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('passes the server list main answers through (HIVE-429)', async () => {
    const answer = { ok: true, hosts: [{ serverId: 'dev_1', name: 'Studio mini', since: '2026-11-17T14:14:00Z' }] };
    bridge({ hosts: vi.fn().mockResolvedValue(answer) });
    await expect(listRelayHosts()).resolves.toEqual(answer);
  });

  it('answers unavailable rather than throwing when main refuses the list (HIVE-429)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({ hosts: vi.fn().mockRejectedValue(new Error('no handler')) });
    await expect(listRelayHosts()).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(error).toHaveBeenCalled();
  });

  it('answers off rather than throwing when main refuses', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({ status: vi.fn().mockRejectedValue(new Error('no handler')), onStatus: vi.fn() });
    await expect(readRelayStatus()).resolves.toEqual({ state: 'off' });
    expect(error).toHaveBeenCalled();
  });
});
