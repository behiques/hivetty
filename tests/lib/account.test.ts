import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelSignIn, onAccountChanged, readAccountState, signIn, signOut } from '@/lib/account';

const bridge = (account: Record<string, unknown>): void => {
  (window as { hive?: unknown }).hive = { account };
};

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
  vi.restoreAllMocks();
});

describe('src/lib/account', () => {
  it('answers null and no-ops with no bridge (the browser target)', async () => {
    await expect(readAccountState()).resolves.toBeNull();
    await expect(signIn()).resolves.toBeNull();
    await expect(cancelSignIn()).resolves.toBeUndefined();
    await expect(signOut()).resolves.toBeUndefined();
    expect(onAccountChanged(vi.fn())).toEqual(expect.any(Function));
  });

  it('passes main answers through', async () => {
    const dispose = vi.fn();
    const account = {
      state: vi.fn().mockResolvedValue({ kind: 'signed-out' }),
      signIn: vi.fn().mockResolvedValue({ ok: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn().mockReturnValue(dispose),
    };
    bridge(account);
    await expect(readAccountState()).resolves.toEqual({ kind: 'signed-out' });
    await expect(signIn()).resolves.toEqual({ ok: true });
    await cancelSignIn();
    await signOut();
    const callback = vi.fn();
    expect(onAccountChanged(callback)).toBe(dispose);
    expect(account.onChanged).toHaveBeenCalledWith(callback);
    expect(account.cancel).toHaveBeenCalled();
    expect(account.signOut).toHaveBeenCalled();
  });

  it('answers null rather than throwing when main refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({
      state: vi.fn().mockRejectedValue(new Error('x')),
      signIn: vi.fn().mockRejectedValue(new Error('x')),
      cancel: vi.fn().mockRejectedValue(new Error('x')),
      signOut: vi.fn().mockRejectedValue(new Error('x')),
    });
    await expect(readAccountState()).resolves.toBeNull();
    await expect(signIn()).resolves.toBeNull();
    await expect(cancelSignIn()).resolves.toBeUndefined();
    await expect(signOut()).resolves.toBeUndefined();
  });
});
