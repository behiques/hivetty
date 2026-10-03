import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NeedsYou } from '@features/home/components/needs-you';
import { useHiveStore } from '@stores/hive-store';
import { notif } from '@tests/support/notifications';

const NOW = 1_700_000_000_000 + 60 * 60_000;

describe('NeedsYou', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const ask = (id: string, minutesAgo: number, subject = id) =>
    notif({
      id,
      kind: 'agent.ask',
      subject,
      title: `asks ${id}`,
      body: '',
      createdAt: NOW - minutesAgo * 60_000,
      action: { type: 'ask', thread: id },
    });

  it('heads with the queue count and lists the oldest wait first', () => {
    useHiveStore.setState({ notifs: [ask('builder', 2), ask('slack', 31), ask('shipper', 14)] });
    render(<NeedsYou />);
    expect(screen.getByRole('heading', { name: /needs you/i })).toHaveTextContent('3');
    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('31m'),
      expect.stringContaining('14m'),
      expect.stringContaining('2m'),
    ]);
  });

  it('caps at five rows with a more line', () => {
    useHiveStore.setState({ notifs: [1, 2, 3, 4, 5, 6, 7].map((n) => ask(`a${n}`, n)) });
    render(<NeedsYou />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByText('2 more in the Inbox ›')).toBeInTheDocument();
  });

  it('a row opens the asker', () => {
    const openEntity = vi.fn(() => true);
    useHiveStore.setState({ notifs: [ask('builder', 2)], openEntity });
    render(<NeedsYou />);
    fireEvent.click(screen.getByRole('button'));
    expect(openEntity).toHaveBeenCalled();
  });

  it('a row with no asker names the title and is not a button', () => {
    useHiveStore.setState({
      notifs: [
        notif({
          id: 'x',
          kind: 'agent.ask',
          title: 'Someone asks',
          body: 'first line\nsecond',
          createdAt: NOW - 60_000,
          action: { type: 'ask', thread: 'x' },
        }),
      ],
    });
    render(<NeedsYou />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Someone asks')).toBeInTheDocument();
    expect(screen.getByText('first line')).toBeInTheDocument();
  });
});
