import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAgents } from '@/lib/agents';
import { resetShippedState } from '@/lib/shipped';

import { AgentsStage } from '@features/agents/components/agents-stage';
import { useEditorStore } from '@stores/editor-store';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';

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
    useUiStore.getState().openAgentPage(null, 'definition');
    render(<AgentsStage />);

    act(() => {
      useUiStore.getState().closeAgentPage();
    });

    expect(screen.getByText('Pick an agent')).toBeInTheDocument();
  });
});
