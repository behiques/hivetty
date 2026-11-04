import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OvermindHead } from '@features/orchestrator/components/overmind-head';
import { projectConfigSnapshot, resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';
import { COPILOT_MODELS, resolveClis } from '@shared/cli-contract';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { seedDemoFleet, seedDemoProjectConfig } from '@tests/support/demo-fleet';

describe('OvermindHead (HIVE-197)', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    useUiStore.getState().reset();
    seedDemoFleet();
    seedDemoProjectConfig();
  });
  afterEach(() => resetProjectConfig());

  it('unfiltered: Overmind, the fleet line, the filter and New session', async () => {
    render(<OvermindHead />);
    expect(screen.getByRole('heading', { level: 1, name: 'Overmind' })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ live across \d+ projects? · \d+ needs you · \d+ ended$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Ended' }));
    expect(useUiStore.getState().sessionsFilter).toBe('ended');
    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(useUiStore.getState().picker).toBe(true);
  });

  it('filtered: the breadcrumb clears, New session spawns in the project', async () => {
    useUiStore.getState().setSessionsProject('nova-web');
    render(<OvermindHead />);
    expect(screen.getByRole('heading', { level: 1, name: /nova-web/ })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ live · \d+ ended$/)).toBeInTheDocument();
    const before = useHiveStore.getState().order.length;
    await userEvent.click(screen.getByRole('button', { name: 'New session in nova-web' }));
    expect(useHiveStore.getState().order.length).toBe(before + 1);
    await userEvent.click(screen.getByRole('button', { name: 'Overmind' }));
    expect(useUiStore.getState().sessionsProject).toBeNull();
  });

  it("starts New session in the project on that project's own CLI (HIVE-378)", async () => {
    const current = projectConfigSnapshot()!;
    setProjectConfigForTest({
      ...current,
      projects: current.projects.map((project) =>
        project.id === 'nova-web' ? { ...project, harness: 'copilot' as const } : project,
      ),
    });
    useUiStore.getState().setSessionsProject('nova-web');
    render(<OvermindHead />);
    await userEvent.click(screen.getByRole('button', { name: 'New session in nova-web' }));
    const { order, entities } = useHiveStore.getState();
    expect(entities[order.at(-1)!]).toMatchObject({ project: 'nova-web', harness: 'copilot', model: COPILOT_MODELS[0] });
  });

  it("says on New session when the project's own CLI was skipped (HIVE-387)", async () => {
    const current = projectConfigSnapshot()!;
    setProjectConfigForTest({
      ...current,
      projects: current.projects.map((project) =>
        project.id === 'nova-web' ? { ...project, harness: 'copilot' as const } : project,
      ),
      clis: resolveClis({ copilot: { sessions: false } }),
    });
    useUiStore.getState().setSessionsProject('nova-web');
    render(<OvermindHead />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New session in nova-web' })).toHaveAttribute(
        'title',
        "Copilot, the default for nova-web, isn't available · starting on Claude Code (your default)",
      ),
    );
  });

  it('carries the terminal chevron beside New session, filtered or not, and it opens a terminal', async () => {
    const { unmount } = render(<OvermindHead />);
    expect(screen.getByRole('button', { name: 'Terminal in a project' })).toBeInTheDocument();
    unmount();

    useUiStore.getState().setSessionsProject('nova-web');
    render(<OvermindHead />);
    await userEvent.click(screen.getByRole('button', { name: 'Terminal in a project' }));
    expect(screen.getByText('New terminal in…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /^nova-web/ }));
    const id = useHiveStore.getState().order.at(-1)!;
    expect(useHiveStore.getState().entities[id]).toMatchObject({ kind: 'terminal', project: 'nova-web' });
  });

  it('names the agents working in the project', () => {
    useHiveStore.getState().hydrateAgents([
      {
        name: 'builder',
        description: 'Builds.',
        icon: 'Robot',
        status: 'working',
        wake: { on: [] },
        mcp: [],
        tools: [],
        rotateAfter: 50,
        runs: [],
        live: [{ run: 'r', kind: 'task', trigger: 'ledger', startedAt: 1, lane: 'repo:acme/nova-web' }],
      },
    ]);
    useUiStore.getState().setSessionsProject('nova-web');
    render(<OvermindHead />);
    expect(screen.getByText(/builder is working here$/)).toBeInTheDocument();
  });
});
