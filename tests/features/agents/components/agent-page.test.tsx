import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAgents } from '@/lib/agents';
import { resetShippedState } from '@/lib/shipped';
import { isAgent, type Agent } from '@/types/entity';

import { AgentPage } from '@features/agents/components/agent-page';
import { useEditorStore } from '@stores/editor-store';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';

import type { AgentSummary } from '@shared/agent-contract';

/**
 * The agent page's header and its switch (HIVE-204). The run and pause cases
 * moved here from the agent view with the header that carries them.
 */

const SOURCE = `---
name: watcher
description: Watches #incorp-dev and my mentions.
icon: ph-robot
---
Do the job.
`;

const summary = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  name: 'watcher',
  description: 'Watches #incorp-dev and my mentions.',
  icon: 'ph-robot',
  status: 'sleeping',
  wake: { on: ['slack.mention'], everyMs: 300_000 },
  mcp: [],
  tools: [],
  rotateAfter: 50,
  runs: [],
  ...over,
});

const seed = (over: Partial<AgentSummary> = {}): Agent => {
  useHiveStore.getState().hydrateAgents([summary(over)]);

  const entity = useHiveStore.getState().entities['watcher'];

  if (entity === undefined || !isAgent(entity)) throw new Error('not seeded');

  return entity;
};

/** The whole bridge the page and both views reach for. */
const stub = (agents: Record<string, unknown> = {}) => {
  const bridge = {
    list: vi.fn(async () => ({ agents: [summary()], agentsRoot: '/root/agents' })),
    read: vi.fn(async () => SOURCE),
    write: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => undefined),
    rename: vi.fn(async () => ({ ok: true })),
    onChanged: vi.fn(() => () => {}),
    run: vi.fn(async () => ({ started: true, run: 'r1' })),
    pause: vi.fn(async () => 'paused'),
    resume: vi.fn(async () => 'sleeping'),
    ...agents,
  };

  vi.stubGlobal('hive', {
    agents: bridge,
    ledger: { post: vi.fn(), answer: vi.fn() },
  });

  return bridge;
};

const runNow = () => screen.getByRole('button', { name: 'Run now' });

beforeEach(() => {
  useHiveStore.getState().reset();
  useUiStore.getState().reset();
  useEditorStore.getState().reset();
  resetAgents();
  resetShippedState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentPage — the header', () => {
  it('shows the icon, the name over its description, the switch and Run now', () => {
    seed();
    stub();
    render(<AgentPage name="watcher" />);

    expect(screen.getByText('watcher')).toHaveClass('font-mono');
    expect(screen.getByText('Watches #incorp-dev and my mentions.')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(runNow()).toBeEnabled();
  });

  it('has no back button and no Edit definition', () => {
    seed();
    stub();
    render(<AgentPage name="watcher" />);

    expect(screen.queryByRole('button', { name: 'Back to overmind' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit definition/ })).toBeNull();
  });

  it('opens on Activity when nothing says otherwise', () => {
    seed();
    stub();
    render(<AgentPage name="watcher" />);

    expect(screen.getByRole('radio', { name: 'Activity' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('switches to Definition and keeps the agent', async () => {
    seed();
    stub();
    useUiStore.getState().openAgentPage('watcher', 'activity');
    render(<AgentPage name="watcher" />);

    await userEvent.click(screen.getByRole('radio', { name: 'Definition' }));

    expect(useUiStore.getState().agentPage).toEqual({ name: 'watcher', view: 'definition' });
    expect(await screen.findByRole('textbox', { name: 'name' })).toHaveValue('watcher');
  });

  it('switching does not lose an unsaved buffer', async () => {
    seed();
    stub();
    useUiStore.getState().openAgentPage('watcher', 'definition');
    render(<AgentPage name="watcher" />);

    await screen.findByRole('textbox', { name: 'name' });
    await waitFor(() => expect(useEditorStore.getState().agentDrafts.watcher).toBeDefined());
    await userEvent.type(screen.getByRole('textbox', { name: 'description' }), '!');
    await userEvent.click(screen.getByRole('radio', { name: 'Activity' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Definition' }));

    expect(await screen.findByText('unsaved')).toBeInTheDocument();
  });

  it('disables Activity for a never-saved agent, and shows Definition', async () => {
    stub();
    render(<AgentPage name={null} />);

    expect(screen.getByText('New agent')).toBeInTheDocument();
    expect(screen.getAllByText('not saved yet').length).toBeGreaterThan(0);
    expect(screen.getByRole('radio', { name: 'Activity' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Definition' })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByRole('textbox', { name: 'name' })).toBeInTheDocument();
  });
});

describe('AgentPage — Run now', () => {
  it('runs the agent by name and nothing else', async () => {
    // The IPC key set is closed: a payload carrying a trigger is a hard
    // IpcValidationError, not a silently ignored field.
    seed();
    const { run } = stub();
    render(<AgentPage name="watcher" />);

    await userEvent.click(runNow());

    expect(run).toHaveBeenCalledWith({ name: 'watcher' });
  });

  it.each([
    ['working', /is working/],
    ['saturated', /is saturated/],
    ['paused', /is paused/],
  ])('says why a run refused as %s, on Activity', async (refused, sentence) => {
    seed();
    stub({ run: vi.fn(async () => ({ started: false, refused })) });
    render(<AgentPage name="watcher" />);

    await userEvent.click(runNow());

    expect(await screen.findByRole('status')).toHaveTextContent(sentence);
    expect(screen.queryByText(/runtime is not/)).not.toBeInTheDocument();
  });

  it("a queued run shows agentRunQueued's sentence on Activity", async () => {
    seed();
    stub({ run: vi.fn(async () => ({ started: false, queued: true, behind: 'working' })) });
    render(<AgentPage name="watcher" />);

    await userEvent.click(runNow());

    expect(await screen.findByText(/queued for/)).toBeInTheDocument();
  });

  it('says why when the channel itself rejects', async () => {
    seed();
    stub({ run: vi.fn(async () => Promise.reject(new Error('The agent runtime is not running.'))) });
    render(<AgentPage name="watcher" />);

    await userEvent.click(runNow());

    expect(await screen.findByText(/runtime is not running/)).toBeInTheDocument();
  });

  it("Run now on a dirty draft refuses with today's sentence in the footer", async () => {
    seed();
    const { run } = stub();
    useUiStore.getState().openAgentPage('watcher', 'definition');
    render(<AgentPage name="watcher" />);

    await screen.findByRole('textbox', { name: 'name' });
    await waitFor(() => expect(useEditorStore.getState().agentDrafts.watcher).toBeDefined());
    await userEvent.type(screen.getByRole('textbox', { name: 'description' }), '!');

    expect(runNow()).toHaveAttribute('title', 'Save first — a wake reads the file, not this buffer.');
    await userEvent.click(runNow());

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Save first — a wake reads the file, not this buffer.',
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('Run now on a never-saved agent refuses', async () => {
    const { run } = stub();
    render(<AgentPage name={null} />);

    await screen.findByRole('textbox', { name: 'name' });
    await userEvent.click(runNow());

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Save it first — there is no definition on disk yet.',
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('drops the notice when the page moves to another agent', async () => {
    seed();
    stub({ run: vi.fn(async () => ({ started: false, refused: 'paused' })) });
    const { rerender } = render(<AgentPage name="watcher" />);

    await userEvent.click(runNow());
    await screen.findByText(/is paused/);

    rerender(<AgentPage name="other" />);

    await waitFor(() => expect(screen.queryByText(/is paused/)).toBeNull());
  });
});

describe('AgentPage — Pause', () => {
  it('pauses a sleeping agent through the channel (HIVE-117)', async () => {
    seed();
    const { pause } = stub();
    render(<AgentPage name="watcher" />);

    await userEvent.click(screen.getByRole('button', { name: /Pause/ }));

    expect(pause).toHaveBeenCalledWith({ name: 'watcher' });
  });

  /*
    One control, not two: the states are exclusive, so the button names the
    move rather than offering a disabled twin.
  */
  it('offers Resume, and only Resume, for a paused agent', async () => {
    seed({ status: 'paused' });
    const { resume } = stub();
    render(<AgentPage name="watcher" />);

    expect(screen.queryByRole('button', { name: /⏸ Pause/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Resume/ }));

    expect(resume).toHaveBeenCalledWith({ name: 'watcher' });
  });

  it('shows why a pause failed instead of swallowing it', async () => {
    seed();
    stub({ pause: vi.fn(async () => Promise.reject(new Error('The agent runtime is not running.'))) });
    render(<AgentPage name="watcher" />);

    await userEvent.click(screen.getByRole('button', { name: /Pause/ }));

    expect(await screen.findByText(/The agent runtime is not running/)).toBeInTheDocument();
  });

  it('offers no Stop, because a run is one bounded turn', () => {
    seed();
    stub();
    render(<AgentPage name="watcher" />);

    expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument();
  });

  it('offers no Pause for an agent not yet on disk', () => {
    stub();
    render(<AgentPage name={null} />);

    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
  });
});
