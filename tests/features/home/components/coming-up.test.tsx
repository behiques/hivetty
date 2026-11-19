import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAgents, resetAgents } from '@/lib/agents';
import { resetSwarmsState } from '@/lib/swarms';
import type { Agent } from '@/types/entity';
import { ComingUp } from '@features/home/components/coming-up';
import { useHiveStore } from '@stores/hive-store';

// HIVE-447: SwarmStarters reads the account; these stubs carry no account bridge.
vi.mock('@hooks/use-account', () => ({ useAccount: () => null }));

describe('ComingUp', () => {
  beforeEach(() => useHiveStore.getState().reset());

  it('lists a scheduled wake with its time, and a held pickup with none', () => {
    const at = new Date(2026, 9, 3, 16, 0).getTime();
    const patrol = {
      kind: 'agent',
      id: 'pr-patrol',
      icon: 'Robot',
      sub: 'sweeps PRs',
      task: '',
      status: 'sleeping',
      wake: { on: [] },
      mcp: [],
      nextRunAt: at,
    } as unknown as Agent;
    useHiveStore.setState({
      entities: { 'pr-patrol': patrol },
      agentOrder: ['pr-patrol'],
      ledger: [
        { id: 'h1', ts: 1, from: 's', to: 'builder', kind: 'ask', body: 'x', meta: { after: 'acme/incorp#589', ticket: 'HIVE-214' } },
      ],
    });
    render(<ComingUp />);
    expect(screen.getByText('pr-patrol').closest('div')).toHaveTextContent('16:00');
    expect(screen.getByText('picks up HIVE-214 when incorp#589 ships')).toBeInTheDocument();
  });

  it('is not drawn with nothing scheduled or held', () => {
    const { container } = render(<ComingUp />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ComingUp with no agent installed (HIVE-447)', () => {
  const summary = { name: 'builder', description: 'Builds plans.', icon: 'Robot', status: 'sleeping', wake: { on: [] }, mcp: [], tools: [], rotateAfter: 50, runs: [] };

  /** The agents arrive the way `useAgentsSync` reads them: the bridge's list, after the window mounts. */
  const serveAgents = (agents: unknown[]): void => {
    vi.stubGlobal('hive', {
      agents: { list: vi.fn(async () => ({ agents, agentsRoot: '/root/agents' })), onChanged: vi.fn(() => () => {}) },
      swarms: { list: vi.fn(async () => ({ source: 'cloud', items: [] })), onChanged: vi.fn(() => () => {}) },
    });
  };

  beforeEach(() => {
    useHiveStore.getState().reset();
    resetAgents();
    resetSwarmsState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetAgents();
    resetSwarmsState();
  });

  it('says agents come in swarms, under an Agents heading, with both starters', async () => {
    serveAgents([]);
    render(<ComingUp />);
    await act(() => loadAgents());

    const section = screen.getByRole('region', { name: 'Agents' });
    expect(within(section).getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(within(section).getByText('No agents yet. Agents come in swarms.')).toBeInTheDocument();
    expect(within(section).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Install Standard',
      'Browse swarms',
    ]);
  });

  it('draws nothing before the definitions have been read', () => {
    serveAgents([]);
    const { container } = render(<ComingUp />);

    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing with one agent installed', async () => {
    serveAgents([summary]);
    const { container } = render(<ComingUp />);
    await act(() => loadAgents());

    expect(container).toBeEmptyDOMElement();
  });

  it('shows Coming up, and not the line, when there are rows', async () => {
    serveAgents([]);
    useHiveStore.setState({
      ledger: [{ id: 'h1', ts: 1, from: 's', to: 'builder', kind: 'ask', body: 'x', meta: { after: 'acme/incorp#589', ticket: 'HIVE-214' } }],
    });
    render(<ComingUp />);
    await act(() => loadAgents());

    expect(screen.getByRole('region', { name: 'Coming up' })).toBeInTheDocument();
    expect(screen.queryByText('No agents yet. Agents come in swarms.')).toBeNull();
  });
});
