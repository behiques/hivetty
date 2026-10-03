import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { announcement, ArrivalStack } from '@features/inbox/components/arrival-stack';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';

import { seedLedger } from '@tests/support/ledger';
import { notif, resetNotifIds } from '@tests/support/notifications';

const askEntry = (id: string) => ({
  id,
  ts: Date.now(),
  from: 'builder',
  to: 'overmind',
  kind: 'ask' as const,
  body: 'Run the ledger tests?',
  meta: { options: ['yes', 'no'] },
});

const askRow = (id: string) =>
  notif({ id, kind: 'agent.ask', title: 'Run the ledger tests?', action: { type: 'ask', thread: id } });

const blocked = () => notif({ id: 's1', kind: 'session.blocked', action: { type: 'session', entityId: 'nova' } });

beforeEach(() => {
  resetNotifIds();
  useUiStore.getState().reset();
  seedLedger(['a1', 'a2', 'a3'].map(askEntry));
  useHiveStore.getState().hydrateNotifs(['a1', 'a2', 'a3'].map(askRow));
});

describe('ArrivalStack (HIVE-198)', () => {
  it('draws nothing with nothing up', () => {
    render(<ArrivalStack onStage={null} />);
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('one arrival: the card, no slivers, no burst line', () => {
    useUiStore.getState().pushArrival('a1', false);
    const { container } = render(<ArrivalStack onStage={null} />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(container.querySelectorAll('[data-sliver]')).toHaveLength(0);
    expect(screen.queryByText(/arrived just now/)).toBeNull();
  });

  it('a burst: the newest card, two slivers at most, the line above', () => {
    for (const id of ['a1', 'a2', 'a3']) useUiStore.getState().pushArrival(id, false);
    const { container } = render(<ArrivalStack onStage={null} />);
    expect(screen.getByRole('article').getAttribute('data-notification')).toBe('a3');
    expect(container.querySelectorAll('[data-sliver]')).toHaveLength(2);
    expect(screen.getByText('3 arrived just now · newest first')).toBeInTheDocument();
  });

  it('two up: one sliver', () => {
    for (const id of ['a1', 'a2']) useUiStore.getState().pushArrival(id, false);
    const { container } = render(<ArrivalStack onStage={null} />);
    expect(container.querySelectorAll('[data-sliver]')).toHaveLength(1);
  });

  it('a session off stage: a note instead of a card', () => {
    useHiveStore.getState().hydrateNotifs([blocked()]);
    useUiStore.getState().pushArrival('s1', false);
    render(<ArrivalStack onStage={null} />);
    expect(screen.getByRole('button', { name: 'Open the session' })).toBeInTheDocument();
  });

  it('a review request: the plain notification card', () => {
    useHiveStore.getState().hydrateNotifs([
      notif({ id: 'r1', kind: 'pr.review_requested', title: 'Review #12', action: { type: 'none' } }),
    ]);
    useUiStore.getState().pushArrival('r1', false);
    render(<ArrivalStack onStage={null} />);
    expect(screen.getByText('Review #12')).toBeInTheDocument();
  });

  it('never the session on stage, nor an arrival that has left the queue', () => {
    useHiveStore.getState().hydrateNotifs([blocked()]);
    useUiStore.getState().pushArrival('s1', false);
    useUiStore.getState().pushArrival('gone', false);
    render(<ArrivalStack onStage="nova" />);
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('holds while Settings is open, and rises when it closes', () => {
    useUiStore.getState().pushArrival('a1', false);
    useUiStore.getState().openSettings();
    render(<ArrivalStack onStage={null} />);
    expect(screen.queryByRole('article')).toBeNull();
    act(() => useUiStore.getState().closeSettings());
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('announcement reads as the ticket words it', () => {
    expect(announcement(notif({ kind: 'agent.permission', title: 'Run the ledger tests?' }), 'builder')).toBe(
      'builder wants to run a command: Run the ledger tests?',
    );
    expect(announcement(notif({ kind: 'agent.ask', title: 'Which repo?' }), 'pr-patrol')).toBe(
      'pr-patrol asks: Which repo?',
    );
    expect(announcement(notif({ kind: 'session.blocked' }), 'inbox-redesign')).toBe(
      'inbox-redesign asked a question',
    );
  });
});
