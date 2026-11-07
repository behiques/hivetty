import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelSignIn,
  initialOf,
  listDevices,
  onAccountChanged,
  onDeviceCode,
  openAccountWeb,
  readAccountState,
  signIn,
  signInWithCode,
  signOut,
} from '@/lib/account';

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
    await expect(openAccountWeb('/account/plan')).resolves.toBeNull();
    expect(onAccountChanged(vi.fn())).toEqual(expect.any(Function));
  });

  it('passes main answers through', async () => {
    const dispose = vi.fn();
    const account = {
      state: vi.fn().mockResolvedValue({ kind: 'signed-out' }),
      signIn: vi.fn().mockResolvedValue({ ok: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
      openWeb: vi.fn().mockResolvedValue({ error: 'Sign in to HiveTTY first.' }),
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
    await expect(openAccountWeb('/account/plan')).resolves.toEqual({ error: 'Sign in to HiveTTY first.' });
    expect(account.openWeb).toHaveBeenCalledWith('/account/plan');
  });

  it('answers null rather than throwing when main refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({
      state: vi.fn().mockRejectedValue(new Error('x')),
      signIn: vi.fn().mockRejectedValue(new Error('x')),
      cancel: vi.fn().mockRejectedValue(new Error('x')),
      signOut: vi.fn().mockRejectedValue(new Error('x')),
      openWeb: vi.fn().mockRejectedValue(new Error('x')),
    });
    await expect(readAccountState()).resolves.toBeNull();
    await expect(signIn()).resolves.toBeNull();
    await expect(cancelSignIn()).resolves.toBeUndefined();
    await expect(signOut()).resolves.toBeUndefined();
    await expect(openAccountWeb('/account/plan')).resolves.toBeNull();
  });

  describe('signInWithCode (HIVE-266 flow, HIVE-265 gate)', () => {
    it('answers null with no bridge', async () => {
      await expect(signInWithCode()).resolves.toBeNull();
    });

    it('passes the end of the flow through, failure and all', async () => {
      const signInWithCodeCall = vi.fn().mockResolvedValue({ error: 'The sign-in was denied.', failure: 'denied' });
      bridge({ signInWithCode: signInWithCodeCall });
      await expect(signInWithCode()).resolves.toEqual({ error: 'The sign-in was denied.', failure: 'denied' });
      expect(signInWithCodeCall).toHaveBeenCalledWith();
    });

    it('answers null and logs when main refuses', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      bridge({ signInWithCode: vi.fn().mockRejectedValue(new Error('x')) });
      await expect(signInWithCode()).resolves.toBeNull();
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('onDeviceCode', () => {
    it('is a no-op unsubscribe with no bridge', () => {
      expect(onDeviceCode(vi.fn())).toEqual(expect.any(Function));
    });

    it('subscribes through the bridge', () => {
      const dispose = vi.fn();
      const account = { onDeviceCode: vi.fn().mockReturnValue(dispose) };
      bridge(account);
      const callback = vi.fn();
      expect(onDeviceCode(callback)).toBe(dispose);
      expect(account.onDeviceCode).toHaveBeenCalledWith(callback);
    });
  });

  describe('listDevices (HIVE-265)', () => {
    it('answers null with no bridge', async () => {
      await expect(listDevices()).resolves.toBeNull();
    });

    it('passes the devices through', async () => {
      const devices = [{ id: 'd', name: 'Mac', lastSeenAt: '2026-11-07', createdAt: '2026-11-01', current: true }];
      bridge({ devices: vi.fn().mockResolvedValue({ devices }) });
      await expect(listDevices()).resolves.toEqual({ devices });
    });

    it('answers null and logs when main refuses', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      bridge({ devices: vi.fn().mockRejectedValue(new Error('x')) });
      await expect(listDevices()).resolves.toBeNull();
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  it('initialOf takes the name, else the email, upper-cased', () => {
    expect(initialOf({ name: 'ana ruiz', email: 'x@y.z' })).toBe('A');
    expect(initialOf({ name: '  ', email: 'zed@y.z' })).toBe('Z');
  });
});
