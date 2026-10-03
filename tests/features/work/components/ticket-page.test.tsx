import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/types/entity';
import type { Ticket } from '@/types/ticket';
import { TicketPage, WorkStage } from '@features/work/components/ticket-page';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { seedDemoFleet } from '@tests/support/demo-fleet';
import type { JiraIssueDetail } from '@shared/jira-contract';

/** The Work page's shell: header, description, loading and errors, refresh (HIVE-203). */

const readJiraDetail = vi.fn();
const readJiraComments = vi.fn();
const readJiraTransitions = vi.fn();
const readJiraIssue = vi.fn();

vi.mock('@/lib/jira', () => ({
  readJiraStatus: () => Promise.resolve(null),
  searchJiraIssues: () => Promise.resolve(null),
  readJiraDetail: (request: unknown) => readJiraDetail(request),
  readJiraComments: (request: unknown) => readJiraComments(request),
  readJiraTransitions: (request: unknown) => readJiraTransitions(request),
  readJiraIssue: (request: unknown) => readJiraIssue(request),
  applyJiraTransition: () => Promise.resolve(null),
  addJiraComment: () => Promise.resolve(null),
}));

const ok = <T,>(value: T) => ({ ok: true as const, value });
const fail = (message: string) => ({ ok: false as const, error: { kind: 'unknown' as const, message } });
const paragraph = (text: string): JiraIssueDetail => ({
  description: [{ kind: 'paragraph', runs: [{ text, marks: [] }] }],
  parent: null,
});

const ticket: Ticket = {
  key: 'GRAC-3018',
  status: 'In Progress',
  statusCategory: 'in-progress',
  title: '[FE] Hero refresh',
  priority: null,
  assignee: null,
  url: 'https://jira.example/browse/GRAC-3018',
};

/** A promise whose resolution the test controls. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  useHiveStore.getState().reset();
  useUiStore.getState().reset();
  seedDemoFleet();
  useHiveStore.setState({ tickets: [ticket, { ...ticket, key: 'GRAC-3022', title: 'Other' }], prs: [], ledger: [] });
  readJiraDetail.mockResolvedValue(ok(paragraph('The description')));
  readJiraComments.mockResolvedValue(ok({ comments: [], total: 0 }));
  readJiraTransitions.mockResolvedValue(ok([]));
  readJiraIssue.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkStage (HIVE-203)', () => {
  it('asks for a ticket when none is open', () => {
    render(<WorkStage />);

    expect(screen.getByText('Pick a ticket')).toBeInTheDocument();
  });

  it('shows the open ticket', async () => {
    useUiStore.getState().openWorkTicket('GRAC-3018');
    render(<WorkStage />);

    expect(await screen.findByRole('region', { name: 'Ticket GRAC-3018' })).toBeInTheDocument();
  });
});

describe('TicketPage (HIVE-203)', () => {
  it('draws the header from the list at once, and the description once read', async () => {
    const detail = deferred<unknown>();
    readJiraDetail.mockReturnValueOnce(detail.promise);
    render(<TicketPage ticketKey="GRAC-3018" />);

    expect(screen.getByRole('link', { name: 'GRAC-3018' })).toHaveAttribute('href', ticket.url);
    expect(screen.getByRole('button', { name: 'In Progress — move GRAC-3018' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hero refresh' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading description' })).toBeInTheDocument();

    await act(async () => detail.resolve(ok(paragraph('The description'))));

    expect(screen.getByText('The description')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading description' })).not.toBeInTheDocument();
  });

  it('says so when the description is empty', async () => {
    readJiraDetail.mockResolvedValue(ok({ description: [], parent: null }));
    render(<TicketPage ticketKey="GRAC-3018" />);

    expect(await screen.findByText('No description.')).toBeInTheDocument();
  });

  it('loads on mount and again for another key', async () => {
    const { rerender } = render(<TicketPage ticketKey="GRAC-3018" />);
    await screen.findByText('The description');
    expect(readJiraDetail).toHaveBeenCalledTimes(1);
    expect(readJiraDetail).toHaveBeenCalledWith({ key: 'GRAC-3018' });

    rerender(<TicketPage ticketKey="GRAC-3022" />);

    await waitFor(() => expect(readJiraDetail).toHaveBeenCalledWith({ key: 'GRAC-3022' }));
  });

  it('shows a failed read with Retry in place of the description', async () => {
    readJiraDetail.mockResolvedValue(fail('Jira is down'));
    render(<TicketPage ticketKey="GRAC-3018" />);

    expect(await screen.findByText('Jira is down')).toHaveClass('text-amber');
    readJiraDetail.mockResolvedValue(ok(paragraph('Back again')));

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Back again')).toBeInTheDocument();
  });

  it('keeps an earlier description with its age when a later read fails', async () => {
    render(<TicketPage ticketKey="GRAC-3018" />);
    await screen.findByText('The description');
    readJiraDetail.mockResolvedValue(fail('Jira is down'));

    await act(() => useHiveStore.getState().loadTicketDetail('GRAC-3018'));

    expect(screen.getByText('The description')).toBeInTheDocument();
    expect(screen.getByText('Jira is down')).toBeInTheDocument();
    expect(screen.getByText(/^as of /)).toBeInTheDocument();
  });

  it('turns the pill amber when the ticket needs you', () => {
    useHiveStore.setState((state) => ({
      entities: {
        ...state.entities,
        'hero-refresh': { ...(state.entities['hero-refresh'] as Session), status: 'waiting' },
      },
    }));
    render(<TicketPage ticketKey="GRAC-3018" />);

    expect(screen.getByRole('button', { name: 'In Progress — move GRAC-3018' })).toHaveClass('text-amber');
  });

  it('draws the key and a header skeleton for a ticket it does not know yet', () => {
    readJiraIssue.mockReturnValue(new Promise(() => undefined));
    render(<TicketPage ticketKey="HIVE-999" />);

    expect(screen.getByText('HIVE-999')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading ticket' })).toBeInTheDocument();
  });

  it('refreshes every minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<TicketPage ticketKey="GRAC-3018" />);
    await screen.findByText('The description');
    const before = readJiraDetail.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(readJiraDetail.mock.calls.length).toBe(before + 1);
  });

  it('re-reads the transitions when the status moves', async () => {
    render(<TicketPage ticketKey="GRAC-3018" />);
    await screen.findByText('The description');
    const before = readJiraTransitions.mock.calls.length;

    act(() => {
      useHiveStore.setState((state) => ({
        tickets: state.tickets.map((t) => (t.key === 'GRAC-3018' ? { ...t, status: 'In Review' } : t)),
      }));
    });

    await waitFor(() => expect(readJiraTransitions.mock.calls.length).toBe(before + 1));
  });
});
