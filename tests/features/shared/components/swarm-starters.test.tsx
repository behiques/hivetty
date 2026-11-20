import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SwarmStarters } from '@features/shared/components/swarm-starters';
import type { SwarmsSnapshot } from '@lib/swarms';
import type { AccountState } from '@shared/account-contract';

import { installedSwarm, swarmEntry, swarmItem, swarmListing } from '../../../support/swarms';

const h = vi.hoisted(() => ({ snapshot: null as unknown as SwarmsSnapshot }));
const actions = vi.hoisted(() => ({ install: vi.fn(), browse: vi.fn() }));
const account = vi.hoisted(() => ({ state: null as AccountState | null }));

vi.mock('@hooks/use-swarms', () => ({ useSwarms: () => h.snapshot }));
vi.mock('@hooks/use-swarm-actions', () => ({ useSwarmActions: () => actions }));
vi.mock('@hooks/use-account', () => ({ useAccount: () => account.state }));

const serve = (listing: SwarmsSnapshot['listing']): void => {
  h.snapshot = { listing, busy: new Set(), removing: new Set(), failures: new Map(), lastUpdate: null };
};

beforeEach(() => {
  vi.clearAllMocks();
  account.state = { kind: 'signed-out' };
  serve(swarmListing([swarmItem({ entry: swarmEntry({ id: 'std1', slug: 'dev-squad', title: 'Dev Squad' }) })]));
});

describe('SwarmStarters (HIVE-447)', () => {
  it('offers Install Dev Squad and Browse swarms; Install names the Dev Squad row', () => {
    render(<SwarmStarters />);

    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Install Dev Squad', 'Browse swarms']);
    fireEvent.click(screen.getByRole('button', { name: 'Install Dev Squad' }));
    expect(actions.install).toHaveBeenCalledWith('std1');
  });

  it('with no Dev Squad row, Install Dev Squad installs null (sign in)', () => {
    serve(null);
    render(<SwarmStarters />);

    fireEvent.click(screen.getByRole('button', { name: 'Install Dev Squad' }));
    expect(actions.install).toHaveBeenCalledWith(null);
  });

  it('signed in with no Dev Squad row yet (listing loading or failed), Install Dev Squad browses, never signs in', () => {
    account.state = { kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: 'd1' };
    serve(null);
    render(<SwarmStarters />);

    fireEvent.click(screen.getByRole('button', { name: 'Install Dev Squad' }));
    expect(actions.install).not.toHaveBeenCalled();
    expect(actions.browse).toHaveBeenCalledTimes(1);
  });

  it('with Dev Squad installed, only Browse swarms is offered', () => {
    serve(swarmListing([swarmItem({ entry: swarmEntry({ id: 'std1', slug: 'dev-squad', title: 'Dev Squad' }), installed: installedSwarm() })]));
    render(<SwarmStarters />);

    expect(screen.queryByRole('button', { name: 'Install Dev Squad' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse swarms' })).toBeInTheDocument();
  });

  it('a native row still named standard is not Dev Squad: Install signs in (HIVE-448)', () => {
    serve(swarmListing([swarmItem({ entry: swarmEntry({ id: 'old1' }) })]));
    render(<SwarmStarters />);

    fireEvent.click(screen.getByRole('button', { name: 'Install Dev Squad' }));
    expect(actions.install).toHaveBeenCalledWith(null);
  });

  it('Browse swarms browses', () => {
    render(<SwarmStarters size="sm" />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse swarms' }));
    expect(actions.browse).toHaveBeenCalledTimes(1);
    expect(actions.install).not.toHaveBeenCalled();
  });
});
