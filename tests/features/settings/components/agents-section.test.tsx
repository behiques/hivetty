import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAgents } from '@/lib/agents';
import { resetShippedState } from '@/lib/shipped';

import { AgentsSection } from '@features/settings/components/agents-section';
import { useUiStore } from '@stores/ui-store';

import type { AgentSummary } from '@shared/agent-contract';

import { shippedStatus } from '../../../support/shipped';

const GOOD = `---
name: slack-watcher
description: Watches things.
icon: Ghost
---
Do the job.
`;

const agent = (name: string, over: Partial<AgentSummary> = {}): AgentSummary => ({
  name,
  description: `${name} watches things`,
  icon: 'Ghost',
  status: 'sleeping',
  wake: { on: [] },
  mcp: [],
  tools: [],
  rotateAfter: 50,
  runs: [],
  ...over,
});

const stub = (agents: AgentSummary[], over: Record<string, unknown> = {}) => {
  const bridge = {
    list: vi.fn(async () => ({ agents, agentsRoot: '/root/agents' })),
    read: vi.fn(async () => GOOD),
    write: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => undefined),
    rename: vi.fn(async () => ({ ok: true })),
    onChanged: vi.fn(() => () => {}),
    ...over,
  };

  (window as unknown as { hive?: unknown }).hive = { agents: bridge };

  return bridge;
};

const row = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

beforeEach(() => {
  delete (window as unknown as { hive?: unknown }).hive;
  resetAgents();
  resetShippedState();
  useUiStore.getState().reset();
  vi.restoreAllMocks();
});

describe('AgentsSection', () => {
  it('renders header-only without a bridge, which is the browser demo', () => {
    render(<AgentsSection />);

    expect(
      screen.getByText(/only available in the desktop app/i),
    ).toBeInTheDocument();
  });

  it('invites a first agent when the folder is empty', async () => {
    stub([]);
    render(<AgentsSection />);

    await screen.findByRole('button', { name: '+ New agent' });

    expect(screen.getByText(/Agents folder: \/root\/agents/)).toBeInTheDocument();
  });

  it('lists an agent with its state', async () => {
    stub([agent('slack-watcher')]);
    render(<AgentsSection />);

    expect(await screen.findByText('slack-watcher')).toBeInTheDocument();
    expect(screen.getByText('sleeping')).toBeInTheDocument();
  });

  it('names the agents folder', async () => {
    stub([agent('slack-watcher')]);
    render(<AgentsSection />);

    expect(
      await screen.findByText('Agents folder: /root/agents'),
    ).toBeInTheDocument();
  });

  describe('a broken definition', () => {
    it('is marked invalid', async () => {
      stub([agent('broken', { invalid: 'nope: Unknown key.' })]);
      render(<AgentsSection />);

      expect(await screen.findByText('invalid')).toBeInTheDocument();
    });

    it('can still be opened, so the user can fix it', async () => {
      // Unlike an invalid skill's row, which is disabled: an agent's folder
      // names it, so there is always a file to open.
      stub([agent('broken', { invalid: 'nope: Unknown key.' })]);
      render(<AgentsSection />);

      const target = await screen.findByRole('button', { name: /broken/ });

      expect(target).toBeEnabled();

      await userEvent.click(target);

      expect(useUiStore.getState().agentPage).toEqual({ name: 'broken', view: 'definition' });
    });
  });

  describe('the list', () => {
    it('draws each agent with its own icon before the name', async () => {
      stub([agent('slack-watcher', { icon: 'ph-slack-logo' })]);
      render(<AgentsSection />);

      const target = await screen.findByRole('button', { name: /slack-watcher/ });

      expect(target.querySelector('svg')).not.toBeNull();
    });

    /*
      The Slack-watcher template (HIVE-123) is gone. It demonstrated the epic
      while agents were new; what it does now is offer a second "+ New agent"
      whose output the user has to read and then edit anyway.
    */
    it('offers nothing but New agent, in both states', async () => {
      stub([]);
      render(<AgentsSection />);

      await screen.findByRole('button', { name: '+ New agent' });

      expect(
        screen.queryByRole('button', { name: /Slack watcher/ }),
      ).not.toBeInTheDocument();
    });

    it('holds no editor of its own', async () => {
      stub([agent('slack-watcher')]);
      render(<AgentsSection />);

      await screen.findByRole('button', { name: /slack-watcher/ });

      expect(screen.queryByRole('tab', { name: 'Source' })).toBeNull();
    });
  });

  /*
    The editor moved to the agent's page (HIVE-204). Settings opens it there on
    Definition, through ui-store, and closes itself on the way.
  */
  describe('opening the agent page', () => {
    it('opening an agent opens its page on Definition', async () => {
      stub([agent('slack-watcher')]);
      useUiStore.getState().openSettings('agents');
      render(<AgentsSection />);

      await userEvent.click(await screen.findByRole('button', { name: /slack-watcher/ }));

      expect(useUiStore.getState().agentPage).toEqual({ name: 'slack-watcher', view: 'definition' });
      expect(useUiStore.getState().settings).toBe(false);
    });

    it('New agent opens a never-saved page on Definition', async () => {
      stub([agent('slack-watcher')]);
      render(<AgentsSection />);

      await userEvent.click(await screen.findByRole('button', { name: '+ New agent' }));

      expect(useUiStore.getState().agentPage).toEqual({ name: null, view: 'definition' });
    });

    it('New agent from the empty state does the same', async () => {
      stub([]);
      render(<AgentsSection />);

      await userEvent.click(await screen.findByRole('button', { name: '+ New agent' }));

      expect(useUiStore.getState().agentPage).toEqual({ name: null, view: 'definition' });
    });
  });
});

describe('AgentsSection — shipped agents the user changed', () => {
  const changed = shippedStatus({
    name: 'slack-watcher',
    customised: [{ path: 'limits.parallel', yours: '5', shipped: '2' }],
    bodyEdited: true,
    held: true,
  });

  it('marks only the changed agent in the list', async () => {
    stub([agent('slack-watcher'), agent('pr-patrol')]);
    (window as unknown as { hive: Record<string, unknown> }).hive.shipped = {
      status: vi.fn(async () => [changed]),
    };
    render(<AgentsSection />);

    const dot = await screen.findByLabelText('A newer shipped prompt is waiting');

    expect(within(row('slack-watcher')).getByLabelText('A newer shipped prompt is waiting')).toBe(dot);
    expect(within(row('pr-patrol')).queryByRole('img')).toBeNull();
  });
});
