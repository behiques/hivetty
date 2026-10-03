import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRow } from '@features/agents/components/agent-row';
import type { AgentSummary } from '@shared/agent-contract';
import type { LedgerEntry } from '@shared/ledger-contract';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';

const NOW = 1_790_000_000_000;

/**
 * The row (HIVE-204): a hexagon tile, the name with its age, and the agent's
 * last word on the ledger. The state is said in words in the accessible name,
 * so the tile's colour is never the only carrier.
 */
const summary = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  name: 'watcher',
  description: 'Watches #incorp-dev and my mentions.',
  icon: 'ph-robot',
  status: 'sleeping',
  wake: { on: [] },
  mcp: [],
  tools: [],
  rotateAfter: 50,
  runs: [],
  ...over,
});

const hydrate = (over: Partial<AgentSummary> = {}) => {
  useHiveStore.getState().hydrateAgents([summary(over)]);
};

const said = (over: Partial<LedgerEntry>) => {
  useHiveStore.getState().hydrateLedger([
    {
      id: '20261002-140000-0001',
      ts: NOW - 2 * 60_000,
      from: 'watcher',
      kind: 'post',
      body: '',
      ...over,
    },
  ]);
};

const live = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    run: `r${String(index)}`,
    kind: 'standing' as const,
    trigger: 'interval',
    startedAt: 1,
  }));

const tile = () => document.querySelector('[aria-hidden="true"]') as HTMLElement;

describe('AgentRow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    useHiveStore.getState().reset();
    useUiStore.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing for an id that is not an agent', () => {
    const { container } = render(<AgentRow id="nobody" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('names an asking agent’s ask by its ref, in amber', () => {
    hydrate({ status: 'asking' });
    said({ kind: 'ask', ref: 'a3', body: 'Retry the deploy?\nIt failed twice.' });

    render(<AgentRow id="watcher" />);

    expect(screen.getByText('ask a3')).toHaveClass('text-amber');
    expect(screen.getByText('Retry the deploy?')).toBeInTheDocument();
    expect(screen.queryByText(/failed twice/)).not.toBeInTheDocument();
    expect(tile()).toHaveClass('text-amber');
  });

  it.each([
    ['failed', 'text-red'],
    ['working', 'text-green'],
    ['sleeping', 'text-subtle'],
    ['paused', 'text-subtle'],
  ] as const)('draws a %s agent’s tile in %s', (status, colour) => {
    hydrate({ status });

    render(<AgentRow id="watcher" />);

    expect(tile()).toHaveClass(colour);
  });

  it.each([
    ['failed', 'text-red'],
    ['event', 'text-brand'],
    ['post', 'text-subtle'],
    ['done', 'text-green'],
  ] as const)('colours a %s keyword %s', (kind, colour) => {
    hydrate();
    said({ kind, body: 'something happened' });

    render(<AgentRow id="watcher" />);

    expect(screen.getByText(kind)).toHaveClass(colour);
  });

  it('shows the age of its last word in the slot', () => {
    hydrate();
    said({ kind: 'done', body: 'Shipped' });

    render(<AgentRow id="watcher" />);

    expect(screen.getByText('2m')).toHaveClass('w-[44px]');
  });

  it('renders the reason, in amber, when the file will not parse', () => {
    hydrate({ status: 'asking', invalid: 'name: Required.', description: '' });
    said({ kind: 'ask', ref: 'a71', body: 'Retry?' });

    render(<AgentRow id="watcher" />);

    expect(screen.getByText('invalid')).toHaveClass('text-amber');
    expect(screen.getByText('name: Required.')).toBeInTheDocument();
    // `invalid` wins: an ask ref beside it would suggest it is running.
    expect(screen.queryByText(/a71/)).not.toBeInTheDocument();
    expect(tile()).toHaveClass('text-amber');
  });

  it('says paused for a paused agent that has never written', () => {
    hydrate({ status: 'paused' });

    render(<AgentRow id="watcher" />);

    expect(screen.getByText('paused')).toHaveClass('text-amber');
    expect(screen.getByRole('button', { name: /^watcher, paused/ })).toBeInTheDocument();
  });

  it('says the state, the live runs and the last word in its accessible name', () => {
    useHiveStore
      .getState()
      .hydrateAgents([summary({ name: 'shipper', status: 'working', live: live(2) })]);
    said({ from: 'shipper', kind: 'event', body: '#303 CI green, handing to acr' });

    render(<AgentRow id="shipper" />);

    expect(
      screen.getByRole('button', {
        name: 'shipper, working, 2 runs live. Last: event, #303 CI green, handing to acr, 2m',
      }),
    ).toBeInTheDocument();
    expect(tile().querySelector('b')).toHaveTextContent('2');
  });

  it('opens the agent when clicked', async () => {
    hydrate();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<AgentRow id="watcher" />);
    await user.click(screen.getByRole('button', { name: /^watcher/ }));

    expect(useUiStore.getState().agentPage).toEqual({ name: 'watcher', view: 'activity' });
  });

  it('marks the row whose page is open', () => {
    hydrate();
    useUiStore.getState().openAgentPage('watcher', 'definition');

    render(<AgentRow id="watcher" />);

    expect(screen.getByRole('button', { name: /^watcher/ })).toHaveAttribute('aria-current', 'true');
  });

  it('marks nothing while another agent’s page is open', () => {
    hydrate();
    useUiStore.getState().openAgentPage('other', 'activity');

    render(<AgentRow id="watcher" />);

    expect(screen.getByRole('button', { name: /^watcher/ })).not.toHaveAttribute('aria-current');
  });
});
