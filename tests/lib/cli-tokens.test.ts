import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearCliToken, cliTokensState, setCliToken } from '@lib/cli-tokens';
import type { CliTokensState } from '@shared/cli-contract';

type CliBridge = NonNullable<Window['hive']>['cli'];

const HELD: CliTokensState = { copilot: true, encryptionAvailable: true };

afterEach(() => {
  delete window.hive;
  vi.restoreAllMocks();
});

/** Install a partial bridge; the cast is confined to this helper. */
function bridge(cli: Partial<CliBridge>): void {
  window.hive = { cli } as unknown as NonNullable<Window['hive']>;
}

describe('the CLI token bridge (HIVE-343)', () => {
  it('answers null with no bridge, silently', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await cliTokensState()).toBeNull();
    expect(await setCliToken({ cli: 'copilot', token: 'gho_x' })).toBeNull();
    expect(await clearCliToken({ cli: 'copilot' })).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('calls each verb on the bridge', async () => {
    const tokensState = vi.fn().mockResolvedValue(HELD);
    const setToken = vi.fn().mockResolvedValue(HELD);
    const clearToken = vi.fn().mockResolvedValue({ ...HELD, copilot: false });

    bridge({ tokensState, setToken, clearToken });

    expect(await cliTokensState()).toEqual(HELD);
    expect(await setCliToken({ cli: 'copilot', token: 'gho_x' })).toEqual(HELD);
    expect(setToken).toHaveBeenCalledWith({ cli: 'copilot', token: 'gho_x' });
    expect(await clearCliToken({ cli: 'copilot' })).toEqual({ ...HELD, copilot: false });
    expect(clearToken).toHaveBeenCalledWith({ cli: 'copilot' });
  });

  it('answers null on a rejected verb, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    bridge({ tokensState: vi.fn().mockRejectedValue(new Error('down')) });

    expect(await cliTokensState()).toBeNull();
    expect(error).toHaveBeenCalledOnce();
  });
});
