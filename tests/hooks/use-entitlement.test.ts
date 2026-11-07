import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEntitlement } from '@/hooks/use-entitlement';

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

const lease = (features: string[]) => ({ kind: 'licensed', plan: 'solo', features, limits: {}, exp: 2_000_000_000, iat: 1_800_000_000 });

describe('useEntitlement', () => {
  it('is locked with no bridge, with the upgrade path', () => {
    expect(renderHook(() => useEntitlement('cli.codex')).result.current).toEqual({
      allowed: false,
      reason: 'Sign in to use Codex',
      plan: 'Solo',
      upgradeUrl: '/account/plan',
    });
  });

  it('follows a new lease with no reload', async () => {
    let push!: (s: unknown) => void;
    (window as { hive?: unknown }).hive = {
      licence: {
        state: () => Promise.resolve(lease(['cli.codex'])),
        onChanged: (cb: (s: unknown) => void) => {
          push = cb;
          return vi.fn();
        },
      },
    };
    const { result } = renderHook(() => useEntitlement('cli.copilot'));
    await waitFor(() => expect(result.current).toMatchObject({ allowed: false, reason: 'Copilot is in Team and above' }));
    act(() => push(lease(['cli.codex', 'cli.copilot'])));
    expect(result.current).toEqual({ allowed: true });
  });
});
