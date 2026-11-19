import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SwarmStarters } from '@features/shared/components/swarm-starters';
import type { SwarmsSnapshot } from '@lib/swarms';

import { installedSwarm, swarmEntry, swarmItem, swarmListing } from '../../../support/swarms';

const h = vi.hoisted(() => ({ snapshot: null as unknown as SwarmsSnapshot }));
const actions = vi.hoisted(() => ({ install: vi.fn(), browse: vi.fn() }));

vi.mock('@hooks/use-swarms', () => ({ useSwarms: () => h.snapshot }));
vi.mock('@hooks/use-swarm-actions', () => ({ useSwarmActions: () => actions }));

const serve = (listing: SwarmsSnapshot['listing']): void => {
  h.snapshot = { listing, busy: new Set(), removing: new Set(), failures: new Map(), lastUpdate: null };
};

beforeEach(() => {
  vi.clearAllMocks();
  serve(swarmListing([swarmItem({ entry: swarmEntry({ id: 'std1' }) })]));
});

describe('SwarmStarters (HIVE-447)', () => {
  it('offers Install Standard and Browse swarms; Install names the Standard row', () => {
    render(<SwarmStarters />);

    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Install Standard', 'Browse swarms']);
    fireEvent.click(screen.getByRole('button', { name: 'Install Standard' }));
    expect(actions.install).toHaveBeenCalledWith('std1');
  });

  it('with no Standard row, Install Standard installs null (sign in)', () => {
    serve(null);
    render(<SwarmStarters />);

    fireEvent.click(screen.getByRole('button', { name: 'Install Standard' }));
    expect(actions.install).toHaveBeenCalledWith(null);
  });

  it('with Standard installed, only Browse swarms is offered', () => {
    serve(swarmListing([swarmItem({ entry: swarmEntry({ id: 'std1' }), installed: installedSwarm() })]));
    render(<SwarmStarters />);

    expect(screen.queryByRole('button', { name: 'Install Standard' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse swarms' })).toBeInTheDocument();
  });

  it('Browse swarms browses', () => {
    render(<SwarmStarters size="sm" />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse swarms' }));
    expect(actions.browse).toHaveBeenCalledTimes(1);
    expect(actions.install).not.toHaveBeenCalled();
  });
});
