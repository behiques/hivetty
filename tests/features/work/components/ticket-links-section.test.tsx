import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TicketDetail } from '@/types/ticket';
import { TicketLinks } from '@features/work/components/ticket-links-section';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import type { JiraLink, JiraStatusCategory } from '@shared/jira-contract';

/** A ticket's links, drawn by the session Ticket tab and the Work page's column (HIVE-202). */

const readJiraLinks = vi.fn();

vi.mock('@/lib/jira', () => ({
  readJiraStatus: () => Promise.resolve(null),
  searchJiraIssues: () => Promise.resolve(null),
  readJiraDetail: () => new Promise(() => undefined),
  readJiraComments: () => new Promise(() => undefined),
  readJiraTransitions: () => new Promise(() => undefined),
  readJiraIssue: () => new Promise(() => undefined),
  readJiraLinks: (request: unknown) => readJiraLinks(request),
}));

const seed = (entry: Partial<TicketDetail> = {}) =>
  useHiveStore.setState({ ticketDetails: { 'HIVE-193': { key: 'HIVE-193', problems: {}, ...entry } } });

beforeEach(() => {
  vi.clearAllMocks();
  useHiveStore.getState().reset();
  useUiStore.getState().reset();
  readJiraLinks.mockResolvedValue(null);
});

afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
  });
});

const link = (
  key: string,
  statusCategory: JiraStatusCategory,
  linkType: string,
  direction: 'inward' | 'outward',
): JiraLink => ({
  kind: 'issue',
  title: `${key} — t`,
  url: `https://x/browse/${key}`,
  relationship: 'r',
  status: 'S',
  key,
  summary: `${key} title`,
  statusCategory,
  linkType,
  direction,
});
const remote: JiraLink = { kind: 'remote', title: 'Doc', url: 'https://doc' };
const three = [
  link('HIVE-188', 'done', 'Blocks', 'inward'),
  link('HIVE-194', 'todo', 'Blocks', 'outward'),
  link('HIVE-179', 'done', 'Relates', 'outward'),
  remote,
];

describe('TicketLinks (HIVE-202)', () => {
  it('counts the linked tickets and says whether it is clear to go', () => {
    seed({ links: three });
    const { unmount } = render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    expect(screen.getByRole('heading', { name: 'Links 3' })).toBeInTheDocument();
    const lead = screen.getByText('Clear to go.');
    expect(lead.tagName).toBe('B');
    const clear = lead.closest('p')!;
    expect(clear).toHaveTextContent('Clear to go. Its one blocker is done; 1 ticket waits on it.');
    // Both tones sit in their soft box, with a leading icon (HIVE-229).
    expect(clear).toHaveClass('text-green', 'bg-green-soft');
    expect(clear.firstElementChild).toHaveAttribute('data-icon', 'check');
    unmount();

    seed({ links: [link('HIVE-188', 'todo', 'Blocks', 'inward')] });
    render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    const blocked = screen.getByText('Blocked by 1 open:').closest('p')!;
    expect(blocked).toHaveClass('text-amber-text', 'bg-amber-soft');
    expect(blocked.firstElementChild).toHaveAttribute('data-icon', 'x');
  });

  it('says there are no linked tickets, with no drawing, when only remote links exist', () => {
    seed({ links: [remote] });
    render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    expect(screen.getByRole('heading', { name: 'Links 0' })).toBeInTheDocument();
    expect(screen.getByText('No linked tickets')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^Links of/ })).toBeNull();
  });

  it('draws a row per non-empty arc, each opening its list', async () => {
    seed({ links: three.slice(0, 2) });
    render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    const waits = screen.getByRole('button', { name: /^Waits on/ });
    expect(waits).toHaveTextContent('Waits on1✓1');
    const blocks = screen.getByRole('button', { name: /^Blocks/ });
    expect(blocks).toHaveTextContent('Blocks1◌1');
    // The glyph is its own node, spaced off its count, so "✓1" never reads as one mark.
    const glyph = within(waits).getByText('✓');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph.parentElement).toHaveTextContent(/^✓1$/);
    expect(glyph.parentElement).toHaveClass('gap-0.5');
    expect(blocks).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^Relates to/ })).not.toBeInTheDocument();

    await userEvent.click(blocks);

    expect(blocks).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'HIVE-194 HIVE-194 title S' }));
    expect(useUiStore.getState().workTicket).toBe('HIVE-194');

    await userEvent.click(blocks);
    expect(screen.queryByRole('button', { name: 'HIVE-194 HIVE-194 title S' })).not.toBeInTheDocument();
  });

  it('shows the relates row with its counts', () => {
    seed({ links: three });
    render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    expect(screen.getByRole('button', { name: /^Relates to/ })).toHaveTextContent('Relates to1✓1');
  });

  it('opens a constellation cell on Work', async () => {
    seed({ links: three });
    render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    await userEvent.click(screen.getByRole('button', { name: /^HIVE-188/ }));

    expect(useUiStore.getState().workTicket).toBe('HIVE-188');
  });

  it('opens the Waits-on list from the rest cell (D7)', async () => {
    const many = Array.from({ length: 7 }, (_, i) => link(`HIVE-1${String(i + 10)}`, 'todo', 'Blocks', 'inward'));
    seed({ links: many });
    render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    await userEvent.click(screen.getByRole('button', { name: '2 more' }));

    expect(screen.getByRole('button', { name: /^Waits on/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'HIVE-116 HIVE-116 title S' })).toBeInTheDocument();
  });

  it('shows a links problem with Retry in the section when no links were read', async () => {
    seed({ problems: { links: 'Links are down' } });
    render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    expect(screen.getByRole('heading', { name: 'Links' })).toBeInTheDocument();
    expect(screen.getByText('Links are down')).toBeInTheDocument();
    const before = readJiraLinks.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(readJiraLinks.mock.calls.length).toBe(before + 1);
  });

  it('has no links section before the links are read', () => {
    seed();
    render(<TicketLinks ticketKey="HIVE-193" pr={null} />);

    expect(screen.queryByRole('heading', { name: /^Links/ })).not.toBeInTheDocument();
  });

  it('draws the PR it is given as a satellite', () => {
    seed({ links: three });
    render(<TicketLinks ticketKey="HIVE-193" pr={255} />);

    expect(screen.getByText('#255')).toBeInTheDocument();
  });
});
