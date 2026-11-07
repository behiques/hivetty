import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCodeSignIn } from '@features/account/hooks/use-code-sign-in';
import type { DeviceCode } from '@shared/account-contract';

const signInWithCode = vi.hoisted(() => vi.fn());
const onDeviceCode = vi.hoisted(() => vi.fn());
vi.mock('@lib/account', () => ({ signInWithCode, onDeviceCode }));

const CODE: DeviceCode = {
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://c.test/device',
  verificationUriComplete: 'https://c.test/device?user_code=WDJB-MJHT',
  expiresIn: 600,
};

describe('useCodeSignIn', () => {
  let push: (code: DeviceCode) => void;
  let end: (result: unknown) => void;

  beforeEach(() => {
    onDeviceCode.mockReset().mockImplementation((cb: (code: DeviceCode) => void) => {
      push = cb;
      return vi.fn();
    });
    signInWithCode.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          end = resolve;
        }),
    );
  });

  it('start sets active', () => {
    const { result } = renderHook(() => useCodeSignIn());
    act(() => result.current.start());
    expect(result.current).toMatchObject({ active: true, code: null, error: null });
    expect(signInWithCode).toHaveBeenCalledTimes(1);
  });

  it('a pushed code lands only while active', () => {
    const { result } = renderHook(() => useCodeSignIn());
    act(() => push(CODE));
    expect(result.current.code).toBeNull();
    act(() => result.current.start());
    act(() => push(CODE));
    expect(result.current).toMatchObject({ active: true, code: CODE });
  });

  it('{ ok: true } clears the flow', async () => {
    const { result } = renderHook(() => useCodeSignIn());
    act(() => result.current.start());
    act(() => push(CODE));
    await act(async () => end({ ok: true }));
    expect(result.current).toMatchObject({ active: false, code: null, error: null });
  });

  it('a denial keeps its error', async () => {
    const { result } = renderHook(() => useCodeSignIn());
    act(() => result.current.start());
    await act(async () => end({ error: 'The sign-in was denied.', failure: 'denied' }));
    expect(result.current).toMatchObject({ active: false, code: null, error: 'The sign-in was denied.' });
  });

  it('an abort clears it with no error', async () => {
    const { result } = renderHook(() => useCodeSignIn());
    act(() => result.current.start());
    await act(async () => end({ error: 'Cancelled.', failure: 'aborted' }));
    expect(result.current).toMatchObject({ active: false, code: null, error: null });
  });

  it('null (no bridge) clears it', async () => {
    const { result } = renderHook(() => useCodeSignIn());
    act(() => result.current.start());
    await act(async () => end(null));
    expect(result.current).toMatchObject({ active: false, code: null, error: null });
  });
});
