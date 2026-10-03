import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAgents } from '@/lib/agents';
import { resetShippedState } from '@/lib/shipped';

import { AgentsStage } from '@features/agents/components/agents-stage';
import { useEditorStore } from '@stores/editor-store';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { seedDemoFleet } from '@tests/support/demo-fleet';

/** The Agents place's stage (HIVE-204): the open page, or "Pick an agent". */

beforeEach(() => {
  useHiveStore.getState().reset();
  useUiStore.getState().reset();
  useEditorStore.getState().reset();
  resetAgents();
  resetShippedState();
  vi.stubGlobal('hive', {
    agents: {
      list: vi.fn(async () => ({ agents: [], agentsRoot: '/root/agents' })),
      read: vi.fn(async () => null),
      onChanged: vi.fn(() => () => {}),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentsStage', () => {
  it('asks for an agent when none is open', () => {
    seedDemoFleet();
    render(<AgentsStage />);

    expect(screen.getByRole('region', { name: 'Agents' })).toHaveTextContent('Pick an agent');
  });

  it('shows a never-saved page for a new agent', async () => {
    useUiStore.getState().openAgentPage(null, 'definition');
    render(<AgentsStage />);

    expect(screen.getByText('New agent')).toBeInTheDocument();
    expect(screen.getAllByText('not saved yet').length).toBeGreaterThan(0);
    expect(await screen.findByRole('textbox', { name: 'name' })).toBeInTheDocument();
  });

  it('goes back to Pick an agent when the page closes', () => {
    seedDemoFleet();
    useUiStore.getState().openAgentPage(null, 'definition');
    render(<AgentsStage />);

    act(() => {
      useUiStore.getState().closeAgentPage();
    });

    expect(screen.getByText('Pick an agent')).toBeInTheDocument();
  });
});

describe('AgentsStage with no agent (HIVE-211)', () => {
  it('says what an agent is, and New agent opens a blank definition', async () => {
    render(<AgentsStage />);

    expect(screen.getByRole('heading', { name: 'No agents yet' })).toBeInTheDocument();
    expect(screen.getByText(/An agent is a headless Claude the Hive wakes on the ledger or a schedule\./)).toBeInTheDocument();
    expect(screen.queryByText('Pick an agent')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'New agent' }));
    expect(useUiStore.getState().agentPage).toEqual({ name: null, view: 'definition' });
  });
});
