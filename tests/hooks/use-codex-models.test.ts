import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCodexModels } from '@hooks/use-codex-models';
import { CODEX_FALLBACK_MODELS } from '@shared/cli-contract';

const codexModels = vi.fn();
vi.mock('@lib/cli-models', () => ({ codexModels: () => codexModels() }));

const LUNA = { slug: 'gpt-6-luna', description: 'Fast.', defaultEffort: 'medium', efforts: ['medium'] };

describe('useCodexModels', () => {
  beforeEach(() => codexModels.mockReset());

  it("answers the account's list once it arrives", async () => {
    codexModels.mockResolvedValue([LUNA]);
    const { result } = renderHook(() => useCodexModels());
    expect(result.current).toBe(CODEX_FALLBACK_MODELS);
    await waitFor(() => expect(result.current).toEqual([LUNA]));
  });

  it.each([[null], [[]]])('keeps the fallback when the answer is %j', async (answer) => {
    codexModels.mockResolvedValue(answer);
    const { result } = renderHook(() => useCodexModels());
    await waitFor(() => expect(codexModels).toHaveBeenCalled());
    expect(result.current).toBe(CODEX_FALLBACK_MODELS);
  });
});
