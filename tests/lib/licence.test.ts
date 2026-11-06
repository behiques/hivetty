import { afterEach, describe, expect, it, vi } from 'vitest';

import { onLicenceChanged, readLicence, refreshLicence, watchPurchase } from '@/lib/licence';

const bridge = (licence: Record<string, unknown>): void => {
  (window as { hive?: unknown }).hive = { licence };
};

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
  vi.restoreAllMocks();
});

describe('src/lib/licence', () => {
  it('answers null and no-ops with no bridge (the browser target)', async () => {
    await expect(readLicence()).resolves.toBeNull();
    await expect(refreshLicence()).resolves.toBeNull();
    await expect(watchPurchase(true)).resolves.toBeUndefined();
    expect(onLicenceChanged(vi.fn())).toEqual(expect.any(Function));
  });

  it('passes main answers through', async () => {
    const dispose = vi.fn();
    const licence = {
      state: vi.fn().mockResolvedValue({ kind: 'unlicensed' }),
      refresh: vi.fn().mockResolvedValue({ kind: 'lapsed', reason: 'no_plan' }),
      watchPurchase: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn().mockReturnValue(dispose),
    };
    bridge(licence);
    await expect(readLicence()).resolves.toEqual({ kind: 'unlicensed' });
    await expect(refreshLicence()).resolves.toEqual({ kind: 'lapsed', reason: 'no_plan' });
    await watchPurchase(true);
    expect(licence.watchPurchase).toHaveBeenCalledWith(true);
    const callback = vi.fn();
    expect(onLicenceChanged(callback)).toBe(dispose);
    expect(licence.onChanged).toHaveBeenCalledWith(callback);
  });

  it('answers null rather than throwing when main refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({
      state: vi.fn().mockRejectedValue(new Error('x')),
      refresh: vi.fn().mockRejectedValue(new Error('x')),
      watchPurchase: vi.fn().mockRejectedValue(new Error('x')),
    });
    await expect(readLicence()).resolves.toBeNull();
    await expect(refreshLicence()).resolves.toBeNull();
    await expect(watchPurchase(false)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(3);
  });
});
