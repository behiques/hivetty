// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { budgetFrom, installSignals, SHUTDOWN_BUDGET_MS, shutDown } from '../../server/signals';

const after = (ms: number, what: string, order: string[]) => () =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      order.push(what);
      resolve();
    }, ms),
  );

describe('shutDown (HIVE-422)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs release then shutdown, and resolves when they finish', async () => {
    const order: string[] = [];
    let done = false;
    void shutDown(20_000, { release: after(500, 'release', order), shutdown: after(500, 'shutdown', order) }).then(
      () => {
        done = true;
      },
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(order).toEqual(['release', 'shutdown']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves at the budget when the steps never finish', async () => {
    let done = false;
    const never = () => new Promise<void>(() => undefined);
    void shutDown(5_000, { release: never, shutdown: never }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('still runs shutdown when release rejects, and never rejects itself', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const shutdown = vi.fn(() => Promise.resolve());
    await expect(
      shutDown(5_000, { release: () => Promise.reject(new Error('stuck')), shutdown }),
    ).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('stuck');
  });

  it('logs a failing shutdown and resolves', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      shutDown(5_000, { release: () => Promise.resolve(), shutdown: () => Promise.reject(new Error('hook')) }),
    ).resolves.toBeUndefined();
    expect(String(error.mock.calls[0]?.[0])).toContain('hook');
  });

  it('runs the real licence release and shutdown hooks by default', async () => {
    const { onShutdown, resetShutdownHooks } = await import('../../core/shutdown');
    const hook = vi.fn();
    onShutdown(hook);
    try {
      await shutDown(5_000);
      expect(hook).toHaveBeenCalledTimes(1);
    } finally {
      resetShutdownHooks();
    }
  });
});

describe('budgetFrom (HIVE-422)', () => {
  it.each([
    [undefined, SHUTDOWN_BUDGET_MS],
    ['5000', 5000],
    ['0', SHUTDOWN_BUDGET_MS],
    ['abc', SHUTDOWN_BUDGET_MS],
    ['-1', SHUTDOWN_BUDGET_MS],
    ['1.5', SHUTDOWN_BUDGET_MS],
    // setTimeout clamps a delay above 2^31-1 to 1 ms, which would exit before the hooks run.
    ['2147483647', 2_147_483_647],
    ['2147483648', SHUTDOWN_BUDGET_MS],
    ['99999999999999999999', SHUTDOWN_BUDGET_MS],
  ])('HIVETTY_SHUTDOWN_BUDGET_MS=%s gives %d', (value, expected) => {
    expect(SHUTDOWN_BUDGET_MS).toBe(20_000);
    expect(budgetFrom({ HIVETTY_SHUTDOWN_BUDGET_MS: value })).toBe(expected);
  });
});

describe('installSignals (HIVE-422)', () => {
  function harness() {
    const listeners = new Map<string, () => void>();
    const deps = {
      quit: vi.fn(),
      exitNow: vi.fn(),
      on: vi.fn((signal: 'SIGTERM' | 'SIGINT', listener: () => void) => void listeners.set(signal, listener)),
    };
    installSignals(deps);
    return { deps, fire: (signal: string) => listeners.get(signal)?.() };
  }

  it('quits cleanly on the first SIGTERM', () => {
    const { deps, fire } = harness();
    fire('SIGTERM');
    expect(deps.quit).toHaveBeenCalledTimes(1);
    expect(deps.quit).toHaveBeenCalledWith(0);
    expect(deps.exitNow).not.toHaveBeenCalled();
  });

  it('quits cleanly on the first SIGINT', () => {
    const { deps, fire } = harness();
    fire('SIGINT');
    expect(deps.quit).toHaveBeenCalledWith(0);
  });

  it('exits at once on a second signal of either kind', () => {
    const { deps, fire } = harness();
    fire('SIGTERM');
    fire('SIGINT');
    expect(deps.exitNow).toHaveBeenCalledWith(1);
    expect(deps.quit).toHaveBeenCalledTimes(1);
  });

  it('listens on the real process by default', () => {
    const on = vi.spyOn(process, 'on').mockImplementation(() => process);
    installSignals({ quit: vi.fn(), exitNow: vi.fn() });
    expect(on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });
});
