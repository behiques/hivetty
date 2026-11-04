import { afterEach, describe, expect, it, vi } from 'vitest';

import { readCliSignIn } from '@lib/cli-sign-in';

const bridge = (cli: object) => {
  (window as unknown as { hive: unknown }).hive = { cli };
};

afterEach(() => {
  delete (window as unknown as { hive?: unknown }).hive;
  vi.restoreAllMocks();
});

describe('readCliSignIn (HIVE-376)', () => {
  it("answers the bridge's value", async () => {
    const signIn = vi.fn(async () => ({ state: 'in', label: 'a@b.c · Max plan' }));
    bridge({ signIn });
    await expect(readCliSignIn('claude-code')).resolves.toEqual({ state: 'in', label: 'a@b.c · Max plan' });
    expect(signIn).toHaveBeenCalledWith({ cli: 'claude-code' });
  });

  it('answers unknown with no bridge', async () => {
    await expect(readCliSignIn('codex')).resolves.toEqual({ state: 'unknown', label: "Couldn't read the sign-in." });
  });

  it('answers unknown and logs when the call rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge({ signIn: vi.fn(async () => Promise.reject(new Error('down'))) });
    await expect(readCliSignIn('copilot')).resolves.toEqual({ state: 'unknown', label: "Couldn't read the sign-in." });
    expect(error).toHaveBeenCalled();
  });
});
