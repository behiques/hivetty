import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MissingSwarm } from '@features/shared/components/missing-swarm';
import type { SwarmsSnapshot } from '@lib/swarms';

import { swarmEntry, swarmItem, swarmListing } from '../../../support/swarms';

const h = vi.hoisted(() => ({ snapshot: null as unknown as SwarmsSnapshot }));
const actions = vi.hoisted(() => ({ install: vi.fn(), browse: vi.fn() }));

vi.mock('@hooks/use-swarms', () => ({ useSwarms: () => h.snapshot }));
vi.mock('@hooks/use-swarm-actions', () => ({ useSwarmActions: () => actions }));

const serve = (listing: SwarmsSnapshot['listing']): void => {
  h.snapshot = { listing, busy: new Set(), removing: new Set(), failures: new Map(), lastUpdate: null };
};

const PROVIDING = swarmListing([
  swarmItem({ entry: swarmEntry({ id: 'std1', slug: 'dev-squad', title: 'Dev Squad', skills: [{ name: 'work-on', description: 'Work a ticket.' }] }) }),
]);

beforeEach(() => {
  vi.clearAllMocks();
  serve(PROVIDING);
});

describe('MissingSwarm (HIVE-447)', () => {
  it('names the providing swarm and installs it', () => {
    render(<MissingSwarm kind="skill" name="work-on" />);

    expect(screen.getByRole('status')).toHaveTextContent('work-on comes with the Dev Squad swarm.');
    fireEvent.click(screen.getByRole('button', { name: 'Install Dev Squad' }));
    expect(actions.install).toHaveBeenCalledWith('std1');
    expect(actions.browse).not.toHaveBeenCalled();
  });

  it('names an agent provider', () => {
    render(<MissingSwarm kind="agent" name="builder" />);

    expect(screen.getByRole('status')).toHaveTextContent('builder comes with the Dev Squad swarm.');
  });

  it('with no provider, says it is not installed and offers Browse', () => {
    render(<MissingSwarm kind="skill" name="nope" />);

    expect(screen.getByRole('status')).toHaveTextContent("nope isn't installed.");
    expect(screen.queryByRole('button', { name: /^Install/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse swarms' }));
    expect(actions.browse).toHaveBeenCalledTimes(1);
    expect(actions.install).not.toHaveBeenCalled();
  });

  it('a null listing renders the no-provider form', () => {
    serve(null);
    render(<MissingSwarm kind="skill" name="work-on" />);

    expect(screen.getByRole('status')).toHaveTextContent("work-on isn't installed.");
    expect(screen.getByRole('button', { name: 'Browse swarms' })).toBeInTheDocument();
  });

  it('renders children after the button', () => {
    render(
      <MissingSwarm kind="skill" name="work-on">
        <button type="button">Start without it</button>
      </MissingSwarm>,
    );

    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Install Dev Squad', 'Start without it']);
  });
});
