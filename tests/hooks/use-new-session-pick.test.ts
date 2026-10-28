import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNewSessionPick } from '@hooks/use-new-session-pick';
import type { CliModel } from '@shared/cli-contract';
import { useUiStore } from '@stores/ui-store';

const codexModels = vi.fn<() => Promise<CliModel[] | null>>(() => Promise.resolve(null));
vi.mock('@lib/cli-models', () => ({ codexModels: () => codexModels(), lastCodexModels: () => undefined }));

const SOL: CliModel = { slug: 'gpt-6.1-sol', description: '', defaultEffort: 'low', efforts: ['low', 'medium', 'ultra'] };
const LUNA: CliModel = { slug: 'gpt-6-luna', description: '', defaultEffort: 'medium', efforts: ['low', 'medium'] };

describe('useNewSessionPick', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    codexModels.mockReset().mockResolvedValue([SOL, LUNA]);
  });

  it("passes Claude's pick through untouched, ready at once, and never reads Codex's list", () => {
    useUiStore.getState().setNewModel('sonnet');
    useUiStore.getState().setNewEffort('low');
    const { result } = renderHook(() => useNewSessionPick());
    expect(result.current).toMatchObject({
      cli: 'claude-code',
      model: 'sonnet',
      effort: 'low',
      defaultEffort: undefined,
      ready: true,
    });
    expect(codexModels).not.toHaveBeenCalled();
  });

  it("is not ready on Codex until the account's list has answered", async () => {
    act(() => useUiStore.getState().setNewCli('codex'));
    const { result } = renderHook(() => useNewSessionPick());
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it("starts a Codex pick the account lacks on the account's first model", async () => {
    codexModels.mockResolvedValue([LUNA]);
    act(() => useUiStore.getState().setNewCli('codex'));
    const { result } = renderHook(() => useNewSessionPick());
    await waitFor(() => expect(result.current.model).toBe('gpt-6-luna'));
    expect(result.current.efforts).toEqual(['low', 'medium']);
    expect(result.current.defaultEffort).toBe('medium');
  });

  it("resolves an effort the picked model lacks to that model's default, leaving the stored one alone", async () => {
    act(() => {
      useUiStore.getState().setNewCli('codex');
      useUiStore.getState().setNewModel('gpt-6-luna');
      useUiStore.getState().setNewEffort('ultra');
    });
    const { result } = renderHook(() => useNewSessionPick());
    await waitFor(() => expect(codexModels).toHaveBeenCalled());
    expect(result.current).toMatchObject({ model: 'gpt-6-luna', effort: 'medium' });
    expect(useUiStore.getState().newPicks.codex.effort).toBe('ultra');
  });
});
