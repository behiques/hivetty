import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ticket, TicketDetail } from '@/types/ticket';
import { TicketTab } from '@features/work/components/ticket-tab';
import { commentTime } from '@features/work/ticket-presentation';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { seedDemoFleet } from '@tests/support/demo-fleet';
import type { AdfBlock, JiraComment } from '@shared/jira-contract';

/** The session panel's Ticket tab (HIVE-202). */

const readJiraDetail = vi.fn();
const readJiraComments = vi.fn();
const readJiraTransitions = vi.fn();
const readJiraIssue = vi.fn();
const readJiraLinks = vi.fn();

vi.mock('@/lib/jira', () => ({
  readJiraStatus: () => Promise.resolve(null),
  searchJiraIssues: () => Promise.resolve(null),
  readJiraDetail: (request: unknown) => readJiraDetail(request),
  readJiraComments: (request: unknown) => readJiraComments(request),
  readJiraTransitions: (request: unknown) => readJiraTransitions(request),
  readJiraIssue: (request: unknown) => readJiraIssue(request),
  readJiraLinks: (request: unknown) => readJiraLinks(request),
  applyJiraTransition: () => Promise.resolve(null),
  addJiraComment: () => Promise.resolve(null),
}));

const ok = <T,>(value: T) => ({ ok: true as const, value });
/**
 * A read that does not answer during the test, so whatever it seeded stays as
 * seeded. Each is answered (with no bridge) after the test, so no poller sweep
 * is left in flight to swallow the next test's.
 */
const unanswered: ((value: null) => void)[] = [];
const pending = () =>
  new Promise<null>((resolve) => {
    unanswered.push(resolve);
  });

const text = (value: string) => [{ text: value, marks: [] }];
const para = (value: string): AdfBlock => ({ kind: 'paragraph', runs: text(value) });

const ticket: Ticket = {
  key: 'HIVE-193',
  status: 'In Progress',
  statusCategory: 'in-progress',
  title: '[BE] Fix it',
  priority: null,
  assignee: null,
  issueType: 'Bug',
};

const comment: JiraComment = {
  id: '1',
  author: 'Yunid',
  created: '2026-10-02T09:15:00.000-0400',
  body: [para('Shipped the fix')],
};

const criteria: AdfBlock[] = [
  para('Intro'),
  { kind: 'heading', level: 2, runs: text('Acceptance criteria') },
  { kind: 'bullet', runs: text('One') },
  { kind: 'bullet', runs: text('Two') },
  { kind: 'bullet', runs: text('Three') },
];

const seed = (entry: Partial<TicketDetail> = {}) =>
  useHiveStore.setState({
    ticketDetails: {
      'HIVE-193': {
        key: 'HIVE-193',
        problems: {},
        detail: { description: criteria, parent: null },
        comments: [comment],
        ...entry,
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  useHiveStore.getState().reset();
  useUiStore.getState().reset();
  seedDemoFleet();
  useHiveStore.setState({ tickets: [ticket], prs: [], ledger: [] });
  for (const reader of [readJiraDetail, readJiraComments, readJiraTransitions, readJiraIssue, readJiraLinks]) {
    reader.mockImplementation(pending);
  }
});

afterEach(async () => {
  vi.useRealTimers();
  for (const resolve of unanswered.splice(0)) resolve(null);
  await act(async () => {
    await Promise.resolve();
  });
});

describe('TicketTab (HIVE-202)', () => {
  it('heads with the key, the type and the status, and the title without its tags', () => {
    seed();
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    const sub = screen.getByText('HIVE-193').closest('p');
    expect(sub).toHaveTextContent(/HIVE-193\s*· Bug ·\s*In Progress/);
    expect(screen.getByRole('heading', { name: 'Fix it' })).toBeInTheDocument();
  });

  it('lists the acceptance criteria with a count and no checkbox', () => {
    seed();
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    expect(screen.getByRole('heading', { name: 'Acceptance criteria 3' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['One', 'Two', 'Three']);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('falls back to the description, and shows neither for an empty one', () => {
    seed({ detail: { description: [para('Just prose')], parent: null } });
    const { unmount } = render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    expect(screen.getByRole('heading', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByText('Just prose')).toBeInTheDocument();
    unmount();

    seed({ detail: { description: [], parent: null } });
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    expect(screen.queryByRole('heading', { name: 'Description' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Acceptance criteria/ })).not.toBeInTheDocument();
  });

  it('shows the latest comment, and no heading without one', () => {
    seed();
    const { unmount } = render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    expect(screen.getByRole('heading', { name: 'Latest comment' })).toBeInTheDocument();
    expect(screen.getByText(`Yunid · ${commentTime(comment.created)}`)).toBeInTheDocument();
    expect(screen.getByText('Shipped the fix')).toBeInTheDocument();
    unmount();

    seed({ comments: [] });
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    expect(screen.queryByRole('heading', { name: 'Latest comment' })).not.toBeInTheDocument();
  });

  it('opens the ticket on Work', async () => {
    seed();
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    await userEvent.click(screen.getByRole('button', { name: 'Open the ticket ›' }));

    expect(useUiStore.getState().workTicket).toBe('HIVE-193');
    expect(useUiStore.getState().place).toBe('work');
  });

  it('says Jira is not connected when nothing is read and Jira is unconfigured', () => {
    useHiveStore.setState({ tickets: [], ticketSource: { kind: 'unconfigured' } });
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    expect(screen.getByText('Jira is not connected.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a skeleton while nothing is read', () => {
    useHiveStore.setState({ tickets: [] });
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    expect(screen.getByRole('status', { name: 'Loading ticket' })).toBeInTheDocument();
  });

  it('keeps the data beside a problem, and retries', async () => {
    seed({ problems: { detail: 'Jira is down' }, readAt: Date.now() });
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    expect(screen.getByText('Jira is down')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Acceptance criteria 3' })).toBeInTheDocument();
    const before = readJiraDetail.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(readJiraDetail.mock.calls.length).toBe(before + 1);
    expect(readJiraLinks).toHaveBeenLastCalledWith({ key: 'HIVE-193' });
  });

  it('reads on mount and again a minute later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    readJiraDetail.mockResolvedValue(ok({ description: criteria, parent: null }));
    readJiraComments.mockResolvedValue(ok({ comments: [comment], total: 1 }));
    readJiraTransitions.mockResolvedValue(ok([]));
    readJiraLinks.mockResolvedValue(ok([]));
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    await screen.findByRole('heading', { name: 'Acceptance criteria 3' });
    expect(readJiraDetail).toHaveBeenCalledTimes(1);
    expect(readJiraDetail).toHaveBeenCalledWith({ key: 'HIVE-193' });
    expect(readJiraLinks).toHaveBeenCalledTimes(1);
    expect(readJiraLinks).toHaveBeenCalledWith({ key: 'HIVE-193' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(readJiraDetail).toHaveBeenCalledTimes(2);
    expect(readJiraLinks).toHaveBeenCalledTimes(2);
  });

  it('reads a key the map already holds once on mount', async () => {
    seed();
    render(<TicketTab ticketKey="HIVE-193" sessionId="hero-refresh" />);

    await waitFor(() => expect(readJiraDetail).toHaveBeenCalled());
    expect(readJiraDetail).toHaveBeenCalledTimes(1);
    expect(readJiraLinks).toHaveBeenCalledTimes(1);
  });
});
