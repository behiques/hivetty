import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSwarms } from '@/hooks/use-swarms';
import { resetSwarmsState } from '@/lib/swarms';

import type { SwarmsChanged } from '@shared/swarm-contract';

import { installedSwarm, swarmItem, swarmListing } from '../support/swarms';

function Probe() {
  const { listing, lastUpdate } = useSwarms();
  return (
    <p>
      {listing === null ? 'loading' : `${String(listing.items.length)} items`}
      {lastUpdate === null ? '' : ` · ${lastUpdate.title} v${lastUpdate.version}`}
    </p>
  );
}

beforeEach(() => {
  resetSwarmsState();
});

describe('useSwarms', () => {
  it('loads on mount and re-renders when the snapshot changes', async () => {
    let push: (event: SwarmsChanged) => void = () => undefined;
    const list = vi.fn(() => Promise.resolve(swarmListing([swarmItem()])));
    (window as unknown as { hive?: unknown }).hive = {
      swarms: {
        list,
        onChanged: (callback: (event: SwarmsChanged) => void) => {
          push = callback;
          return () => undefined;
        },
      },
    };

    render(<Probe />);
    await waitFor(() => expect(screen.getByText('1 items')).toBeInTheDocument());

    list.mockResolvedValue(swarmListing([swarmItem(), swarmItem({ installed: installedSwarm() })]));
    act(() => push({ updated: { swarmId: 'standard', title: 'Standard', version: '1.5.0' } }));

    await waitFor(() => expect(screen.getByText('2 items · Standard v1.5.0')).toBeInTheDocument());
  });

  it('reads loading without a bridge', () => {
    (window as unknown as { hive?: unknown }).hive = undefined;

    render(<Probe />);

    expect(screen.getByText('loading')).toBeInTheDocument();
  });
});
