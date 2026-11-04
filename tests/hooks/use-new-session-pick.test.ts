import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNewSessionPick } from '@hooks/use-new-session-pick';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';
import { type CliDetection, type CliModel, COPILOT_MODELS, resolveClis } from '@shared/cli-contract';
import { emptySnapshot } from '@shared/config-contract';
import type { HarnessId } from '@shared/harness-contract';
import { useUiStore } from '@stores/ui-store';

const codexModels = vi.fn<() => Promise<CliModel[] | null>>(() => Promise.resolve(null));
vi.mock('@lib/cli-models', () => ({ codexModels: () => codexModels(), lastCodexModels: () => undefined }));

type Detection = Record<HarnessId, CliDetection>;
/** `null` is an answered read with nothing found (the browser): every CLI available, ready at once. */
let lastDetection: Detection | null | undefined = null;
const detect = vi.fn<() => Promise<Detection | null>>(() => Promise.resolve(null));
vi.mock('@lib/cli-detection', () => ({
  detectClis: () => detect(),
  rescanClis: () => detect(),
  lastCliDetection: () => lastDetection,
}));

const SOL: CliModel = { slug: 'gpt-6.1-sol', description: '', defaultEffort: 'low', efforts: ['low', 'medium', 'ultra'] };
const LUNA: CliModel = { slug: 'gpt-6-luna', description: '', defaultEffort: 'medium', efforts: ['low', 'medium'] };

describe('useNewSessionPick', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    resetProjectConfig();
    lastDetection = null;
    detect.mockReset().mockResolvedValue(null);
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
    expect(useUiStore.getState().newPicks.codex?.effort).toBe('ultra');
  });

  it("starts on Settings' session model, until a pick this run replaces it (HIVE-376)", () => {
    setProjectConfigForTest({
      ...emptySnapshot('/tmp/config.json'),
      clis: resolveClis({ copilot: { sessionModel: COPILOT_MODELS[1] } }),
    });
    act(() => useUiStore.getState().setNewCli('copilot'));
    const { result } = renderHook(() => useNewSessionPick());
    expect(result.current.model).toBe(COPILOT_MODELS[1]);
    act(() => useUiStore.getState().setNewModel(COPILOT_MODELS[0], 'copilot'));
    expect(result.current.model).toBe(COPILOT_MODELS[0]);
  });

  it('starts on the configured default when nothing was picked this run (HIVE-375)', async () => {
    lastDetection = undefined;
    detect.mockResolvedValue({
      'claude-code': { path: '/c', version: '1' },
      codex: { path: '/x', version: '2' },
      copilot: { missing: 'gone' },
    });
    setProjectConfigForTest({ ...emptySnapshot('/tmp/config.json'), sessionsDefaultCli: 'codex' });
    const { result } = renderHook(() => useNewSessionPick());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.cli).toBe('codex');
    expect(result.current.availability.copilot).toEqual({ ok: false, reason: 'gone' });
    expect(result.current.noneAvailable).toBe(false);
  });

  it('steps past a CLI turned off in config, the pick included (HIVE-375)', () => {
    act(() => useUiStore.getState().setNewCli('codex'));
    setProjectConfigForTest({
      ...emptySnapshot('/tmp/config.json'),
      clis: resolveClis({ codex: { sessions: false }, 'claude-code': { sessions: false } }),
    });
    const { result } = renderHook(() => useNewSessionPick());
    expect(result.current.cli).toBe('copilot');
    expect(result.current.ready).toBe(true);
  });

  it('is not ready until detection answers, and never ready with nothing available (HIVE-375)', async () => {
    lastDetection = undefined;
    let answer!: (value: Detection) => void;
    detect.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderHook(() => useNewSessionPick());
    expect(result.current.ready).toBe(false);
    await act(async () => answer({ 'claude-code': { missing: 'a' }, codex: { missing: 'b' }, copilot: { missing: 'c' } }));
    expect(result.current.noneAvailable).toBe(true);
    expect(result.current.cli).toBe('claude-code');
    expect(result.current.ready).toBe(false);
  });
});
