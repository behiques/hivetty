import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HARNESS_CHECK_DEBOUNCE_MS, useAgentHarnessCheck } from '@hooks/use-agent-harness-check';

const checkAgentHarness = vi.fn();
vi.mock('@/lib/agents', () => ({ checkAgentHarness: (source: string) => checkAgentHarness(source) }));

const OK = { 'claude-code': { ok: true }, codex: { ok: true }, copilot: { ok: true } };
const NO_CODEX = { ...OK, codex: { ok: false, reason: 'codex cannot start: not found', fix: 'install' } };

const settle = async (ms = HARNESS_CHECK_DEBOUNCE_MS) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useAgentHarnessCheck (HIVE-396)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkAgentHarness.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once the draft has been still for the debounce, and answers the verdicts', async () => {
    checkAgentHarness.mockResolvedValue({ verdicts: NO_CODEX });
    const { result, rerender } = renderHook(({ source }) => useAgentHarnessCheck(source), { initialProps: { source: 'a' } });

    expect(result.current).toBeNull();
    rerender({ source: 'ab' });
    await settle(HARNESS_CHECK_DEBOUNCE_MS - 1);
    expect(checkAgentHarness).not.toHaveBeenCalled();
    await settle(1);
    expect(checkAgentHarness).toHaveBeenCalledTimes(1);
    expect(checkAgentHarness).toHaveBeenCalledWith('ab');
    expect(result.current).toEqual(NO_CODEX);
  });

  it('keeps the last verdicts across a draft that cannot be read', async () => {
    checkAgentHarness.mockResolvedValueOnce({ verdicts: OK }).mockResolvedValueOnce({ problem: 'name: Required.' });
    const { result, rerender } = renderHook(({ source }) => useAgentHarnessCheck(source), { initialProps: { source: 'a' } });

    await settle();
    rerender({ source: 'a-' });
    await settle();
    expect(result.current).toEqual(OK);
  });

  it('keeps the last verdicts when the channel rejects', async () => {
    checkAgentHarness.mockResolvedValueOnce({ verdicts: OK }).mockRejectedValueOnce(new Error('gone'));
    const { result, rerender } = renderHook(({ source }) => useAgentHarnessCheck(source), { initialProps: { source: 'a' } });

    await settle();
    rerender({ source: 'b' });
    await settle();
    expect(result.current).toEqual(OK);
  });

  it('stays null with no bridge', async () => {
    checkAgentHarness.mockResolvedValue(null);
    const { result } = renderHook(() => useAgentHarnessCheck('a'));

    await settle();
    expect(result.current).toBeNull();
  });
});
