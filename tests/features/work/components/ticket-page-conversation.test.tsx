import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ticket } from '@/types/ticket';
import { TicketPageConversation } from '@features/work/components/ticket-page-conversation';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import type { JiraComment } from '@shared/jira-contract';
import type { LedgerEntry } from '@shared/ledger-contract';

/** The ticket page's conversation (HIVE-203). */

const readJiraDetail = vi.fn();
const readJiraComments = vi.fn();
const addJiraComment = vi.fn();

vi.mock('@/lib/jira', () => ({
  readJiraStatus: () => Promise.resolve(null),
  searchJiraIssues: () => Promise.resolve(null),
  readJiraIssue: () => Promise.resolve(null),
  readJiraTransitions: () => Promise.resolve(null),
  readJiraDetail: (request: unknown) => readJiraDetail(request),
  readJiraComments: (request: unknown) => readJiraComments(request),
  addJiraComment: (request: unknown) => addJiraComment(request),
}));

const ticket: Ticket = {
  key: 'HIVE-7',
  status: 'In Progress',
  statusCategory: 'in-progress',
  title: 'Page',
  priority: null,
  assignee: null,
  url: 'https://jira.example/browse/HIVE-7',
};
const comment = (id: string, author: string, created: string, text: string): JiraComment => ({
  id,
  author,
  created,
  body: [{ kind: 'paragraph', runs: [{ text, marks: [] }] }],
});
const dana = comment('100', 'Dana Kim', '2026-10-01T10:00:00.000Z', 'First words');
const acr = comment('101', 'acr', '2026-10-01T12:00:00.000Z', 'Second words');
const event = (id: string, ts: number, meta: Record<string, unknown>, body = 'Built it\nmore detail'): LedgerEntry => ({
  id,
  ts,
  from: 'builder',
  kind: 'post',
  body,
  meta: { ticket: 'HIVE-7', ...meta },
});
const between = event('20261001-110000-0001', Date.parse('2026-10-01T11:00:00.000Z'), { pr: 412 });

const seed = (over: Partial<NonNullable<ReturnType<typeof useHiveStore.getState>['ticketDetail']>> = {}) =>
  useHiveStore.setState({
    tickets: [ticket],
    ledger: [],
    ticketDetail: { key: 'HIVE-7', comments: [dana, acr], total: 2, history: [between], problems: {}, ...over },
  });

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useHiveStore.getState().reset();
  useUiStore.getState().reset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  writeText.mockResolvedValue(undefined);
  readJiraDetail.mockResolvedValue(null);
  readJiraComments.mockResolvedValue(null);
  seed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const items = () => within(screen.getByRole('list', { name: 'Conversation' })).getAllByRole('listitem');

describe('TicketPageConversation (HIVE-203)', () => {
  it('heads the conversation with its counts and a Comments | Everything switch', () => {
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByText('2 comments · 1 event')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Comments' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Everything' })).toBeInTheDocument();
  });

  it('counts in the singular', () => {
    seed({ comments: [dana], total: 1, history: [between, event('20261001-110000-0002', 1, {})] });
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    expect(screen.getByText('1 comment · 2 events')).toBeInTheDocument();
  });

  it('shows only comments, oldest first, then everything interleaved by time', async () => {
    render(<TicketPageConversation ticketKey="HIVE-7" />);
    expect(items().map((item) => item.textContent)).toEqual([
      expect.stringContaining('First words'),
      expect.stringContaining('Second words'),
    ]);

    await userEvent.click(screen.getByRole('radio', { name: 'Everything' }));

    expect(items()).toHaveLength(3);
    expect(items()[1]).toHaveTextContent('builder Built it');
    expect(items()[1]).not.toHaveTextContent('more detail');
  });

  it('gives a comment a face with initials, its author and its time', () => {
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    expect(within(items()[0]!).getByText('DK')).toBeInTheDocument();
    expect(within(items()[1]!).getByText('AC')).toBeInTheDocument();
    expect(within(items()[0]!).getByText('Dana Kim')).toBeInTheDocument();
    expect(within(items()[0]!).getByText(/\d/, { selector: 'time' })).toBeInTheDocument();
  });

  it('marks an event with a PR glyph or the hexagon, and gives it no Reply', async () => {
    seed({ history: [between, event('20261001-115000-0001', Date.parse('2026-10-01T11:50:00.000Z'), {})] });
    render(<TicketPageConversation ticketKey="HIVE-7" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Everything' }));

    const [, pr, plain] = items();
    expect(pr!.querySelector('[data-glyph]')).toHaveAttribute('data-glyph', 'pr');
    expect(plain!.querySelector('[data-glyph]')).toHaveAttribute('data-glyph', 'session');
    expect(within(pr!).queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
  });

  it('puts Reply and Copy link in the time slot, revealed on hover or focus', () => {
    render(<TicketPageConversation ticketKey="HIVE-7" />);
    const first = items()[0]!;

    const time = within(first).getByText(/\d/, { selector: 'time' });
    expect(time).toHaveClass('group-hover:invisible', 'group-focus-within:invisible');
    const actions = within(first).getByRole('button', { name: 'Reply' }).parentElement!;
    expect(actions).toHaveClass('invisible', 'group-hover:visible', 'group-focus-within:visible');
    expect(within(actions).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(actions.parentElement).toBe(time.parentElement);
    expect(time.parentElement).toHaveClass('w-[120px]', 'shrink-0');
  });

  it('says when only the latest comments are shown', () => {
    seed({ total: 80 });
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    expect(screen.getByText(/Showing the latest 2 of 80/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Jira' })).toHaveAttribute('href', ticket.url);
  });

  it('copies a link to the comment', async () => {
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    await userEvent.click(within(items()[0]!).getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(`${ticket.url}?focusedCommentId=100`);
  });

  it('shows a skeleton until the comments land', () => {
    seed({ comments: undefined, total: undefined });
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    expect(screen.getByRole('status', { name: 'Loading conversation' })).toBeInTheDocument();
  });

  it('shows a failed read with Retry', async () => {
    seed({ comments: undefined, total: undefined, problems: { comments: 'Jira is down' } });
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    expect(screen.getByText('Jira is down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(readJiraComments).toHaveBeenCalledWith({ key: 'HIVE-7', newest: true });
  });

  it('keeps the comments it has, with their age, when a re-read fails', () => {
    seed({ problems: { comments: 'Jira is down' }, readAt: Date.parse('2026-10-01T12:30:00.000Z') });
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    expect(screen.getByText('First words')).toBeInTheDocument();
    expect(screen.getByText(/^as of /)).toBeInTheDocument();
  });

  it('says so when there are no comments', () => {
    seed({ comments: [], total: 0, history: [] });
    render(<TicketPageConversation ticketKey="HIVE-7" />);

    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
  });
});
