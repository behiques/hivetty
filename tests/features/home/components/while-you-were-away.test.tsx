import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { hatchedLine, WhileYouWereAway } from '@features/home/components/while-you-were-away';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { notif } from '@tests/support/notifications';
import { prRecord } from '@tests/support/prs';

const SINCE = new Date(2026, 9, 3, 13, 10).getTime();

describe('WhileYouWereAway', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    useUiStore.getState().reset();
    useUiStore.setState({ awaySince: SINCE });
  });

  it('heads with since HH:MM and says so when nothing happened', () => {
    render(<WhileYouWereAway />);
    expect(screen.getByRole('heading', { name: /while you were away/i })).toHaveTextContent(
      'since 13:10',
    );
    expect(screen.getByText('Nothing happened while you were away.')).toBeInTheDocument();
  });

  it('draws each non-zero row in order', () => {
    const after = new Date(SINCE + 60_000).toISOString();
    useHiveStore.setState({
      prs: [
        prRecord({ number: 302, state: 'merged', mergedAt: after, branch: 'a' }),
        prRecord({ number: 303, state: 'merged', mergedAt: after, branch: 'b' }),
      ],
      notifs: [notif({ kind: 'session.goal', title: 'pty-resize goal done', createdAt: SINCE + 1 })],
      ledger: [
        { id: 'r1', ts: SINCE + 1, from: 'acr', kind: 'event', body: 'run.ended — done', meta: { outcome: 'done' } },
        { id: 'r2', ts: SINCE + 2, from: 'acr', kind: 'event', body: 'run.ended — failed', meta: { outcome: 'failed' } },
      ],
    });
    render(<WhileYouWereAway />);
    const text = screen.getByRole('region', { name: /while you were away/i }).textContent ?? '';
    expect(text.indexOf('#302 and #303 hatched')).toBeLessThan(text.indexOf('pty-resize goal done'));
    expect(text.indexOf('pty-resize goal done')).toBeLessThan(text.indexOf('2 agent runs'));
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.queryByText(/ready to start/)).toBeNull();
  });

  it('names the merging party and the ready tickets', () => {
    const after = new Date(SINCE + 60_000).toISOString();
    const ticket = (key: string) => ({
      key,
      status: 'To Do',
      statusCategory: 'todo' as const,
      title: key,
      priority: null,
      assignee: null,
    });
    useHiveStore.setState({
      prs: [prRecord({ number: 302, state: 'merged', mergedAt: after, branch: 'a' })],
      ledger: [
        { id: 'c', ts: SINCE + 1, from: 'shipper', kind: 'post', body: 'closed', meta: { stage: 'closed', repo: 'acme/nova-web', pr: 302 } },
        { id: 'r1', ts: SINCE + 1, from: 'acr', kind: 'event', body: 'run.ended — done', meta: { outcome: 'done' } },
      ],
      tickets: [ticket('A-1'), ticket('B-2'), ticket('C-3')],
    });
    render(<WhileYouWereAway />);
    expect(screen.getByText('shipper merged it')).toBeInTheDocument();
    expect(screen.getByText('1 agent run')).toBeInTheDocument();
    expect(screen.getByText('3 tickets ready to start')).toBeInTheDocument();
    expect(screen.getByText('A-1, B-2 and 1 more have no session')).toBeInTheDocument();
  });

  it('words the hatched PRs', () => {
    expect(hatchedLine([302])).toBe('#302 hatched');
    expect(hatchedLine([302, 303])).toBe('#302 and #303 hatched');
    expect(hatchedLine([1, 2, 3])).toBe('3 PRs hatched');
  });
});
