import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCodexModels } from '@hooks/use-codex-models';
import { CODEX_FALLBACK_MODELS } from '@shared/cli-contract';

const codexModels = vi.fn();
vi.mock('@lib/cli-models', () => ({ codexModels: () => codexModels() }));

const LUNA = { slug: 'gpt-6-luna', description: 'Fast.', defaultEffort: 'medium', efforts: ['medium'] };

describe('useCodexModels', () => {
  beforeEach(() => codexModels.mockReset());

  it("answers the account's list once it arrives, and says when it has", async () => {
    codexModels.mockResolvedValue([LUNA]);
    const { result } = renderHook(() => useCodexModels());
    expect(result.current).toEqual({ models: CODEX_FALLBACK_MODELS, settled: false });
    await waitFor(() => expect(result.current).toEqual({ models: [LUNA], settled: true }));
  });

  it.each([[null], [[]]])('keeps the fallback, settled, when the answer is %j', async (answer) => {
    codexModels.mockResolvedValue(answer);
    const { result } = renderHook(() => useCodexModels());
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.models).toBe(CODEX_FALLBACK_MODELS);
  });

  it('reads nothing until it is enabled, then reads', async () => {
    codexModels.mockResolvedValue([LUNA]);
    const { result, rerender } = renderHook(({ enabled }) => useCodexModels(enabled), { initialProps: { enabled: false } });
    expect(codexModels).not.toHaveBeenCalled();
    expect(result.current.settled).toBe(false);

    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toEqual({ models: [LUNA], settled: true }));
    expect(codexModels).toHaveBeenCalledTimes(1);
  });
});
