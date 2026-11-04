import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNewSessionPick } from '@hooks/use-new-session-pick';
import { TURNED_OFF } from '@lib/harness/session-cli';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';
import { type CliDetection, type CliModel, COPILOT_MODELS, resolveClis } from '@shared/cli-contract';
import { type ConfigSnapshot, emptySnapshot, type ProjectConfig } from '@shared/config-contract';
import type { HarnessId } from '@shared/harness-contract';
import { useUiStore } from '@stores/ui-store';

const codexModels = vi.fn<() => Promise<CliModel[] | null>>(() => Promise.resolve(null));
vi.mock('@lib/cli-models', () => ({ codexModels: () => codexModels(), lastCodexModels: () => undefined }));

type Detection = Record<HarnessId, CliDetection>;
/** `null` is an answered read with nothing found (the browser): every CLI available, ready at once. */
let lastDetection: Detection | null | undefined = null;
const detect = vi.fn<() => Promise<Detection | null>>(() => Promise.resolve(null));
/** The real module's contract: an answer lands in the shared cache, then every subscriber hears it. */
const listeners = new Set<() => void>();
const land = async () => {
  lastDetection = await detect();
  for (const listener of listeners) listener();
  return lastDetection;
};
vi.mock('@lib/cli-detection', () => ({
  detectClis: () => land(),
  rescanClis: () => land(),
  lastCliDetection: () => lastDetection,
  subscribeCliDetection: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
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

describe('useNewSessionPick for a project (HIVE-378)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    resetProjectConfig();
    lastDetection = null;
    detect.mockReset().mockResolvedValue(null);
    codexModels.mockReset().mockResolvedValue([SOL, LUNA]);
  });

  const project = (id: string, name: string, harness?: HarnessId): ProjectConfig => ({
    id,
    key: id.slice(0, 2),
    name,
    path: `/repos/${id}`,
    icon: 'ph-folder',
    origin: 'local',
    status: 'ok',
    isRepo: true,
    ...(harness ? { harness } : {}),
  });
  const seed = (extra: Partial<ConfigSnapshot> = {}) =>
    setProjectConfigForTest({
      ...emptySnapshot('/tmp/config.json'),
      projects: [project('hive', 'hivetty', 'copilot'), project('plain', 'plain')],
      ...extra,
    });

  it("starts on the project's CLI, captioned with its name", () => {
    seed();
    const { result } = renderHook(() => useNewSessionPick(false, 'hive'));
    expect(result.current).toMatchObject({ cli: 'copilot', source: 'project', caption: 'Default for hivetty' });
  });

  it('a project with no CLI uses your default', () => {
    seed({ sessionsDefaultCli: 'copilot' });
    const { result } = renderHook(() => useNewSessionPick(false, 'plain'));
    expect(result.current).toMatchObject({ cli: 'copilot', source: 'yours', caption: 'Your default' });
  });

  it("this run's pick beats the project", () => {
    seed();
    act(() => useUiStore.getState().setNewCli('claude-code'));
    const { result } = renderHook(() => useNewSessionPick(false, 'hive'));
    expect(result.current).toMatchObject({ cli: 'claude-code', source: 'picked', caption: null });
  });

  it('startFor resolves each row on its own', () => {
    seed();
    const { result } = renderHook(() => useNewSessionPick());
    expect(result.current.cli).toBe('claude-code');
    expect(result.current.startFor('hive')).toMatchObject({ cli: 'copilot', source: 'project', model: COPILOT_MODELS[0] });
    expect(result.current.startFor('plain')).toMatchObject({ cli: 'claude-code', source: 'yours' });
  });

  it('startFor names a project default it had to skip (HIVE-387)', () => {
    seed({ clis: resolveClis({ copilot: { sessions: false } }) });
    const { result } = renderHook(() => useNewSessionPick());
    const row = result.current.startFor('hive');
    expect(row).toMatchObject({ cli: 'claude-code', source: 'yours' });
    expect(row.skipped).toEqual([{ cli: 'copilot', source: 'project', reason: TURNED_OFF }]);
    expect(row.caption).toBe("Copilot, the default for hivetty, isn't available · starting on Claude Code (your default)");
  });

  it("reads Codex's list when a project names Codex, so a row click never waits", async () => {
    setProjectConfigForTest({ ...emptySnapshot('/tmp/config.json'), projects: [project('hive', 'hivetty', 'codex')] });
    const { result } = renderHook(() => useNewSessionPick());
    await waitFor(() => expect(result.current.startFor('hive')).toMatchObject({ cli: 'codex', model: 'gpt-6.1-sol' }));
  });
});
