import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BRIDGE_ERROR } from '@lib/utils';
import { useHiveStore } from '@stores/hive-store';
import type { JiraComment, JiraIssue, JiraIssueDetail, JiraTransition } from '@shared/jira-contract';
import type { LedgerEntry } from '@shared/ledger-contract';

/**
 * The open ticket's detail slice (HIVE-203).
 *
 * `lib/jira` is mocked: what is under test is how each answer merges, that one
 * failed read never blanks another, and that a late answer for a ticket no
 * longer open is dropped.
 */

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
}));

const ok = <T,>(value: T) => ({ ok: true as const, value });
const fail = (message: string) => ({ ok: false as const, error: { kind: 'unknown' as const, message } });

const detail: JiraIssueDetail = { description: [], parent: { key: 'HIVE-194', summary: 'Epic' } };
const comment = (id: string): JiraComment => ({ id, author: 'Dana Kim', created: '2026-10-01T10:00:00.000Z', body: [] });
const transition: JiraTransition = { id: '31', name: 'Done', to: { name: 'Done', statusCategory: 'done' } };
const entry: LedgerEntry = { id: '20261002-100000-0001', ts: 1, from: 'builder', kind: 'post', body: 'x', meta: { ticket: 'HIVE-7' } };
const issue: JiraIssue = {
  key: 'HIVE-8',
  summary: '[BE] Remote ticket',
  status: 'To Do',
  statusCategory: 'todo',
  issueType: 'Story',
  priority: 'High',
  assignee: null,
  updated: '2026-10-01T00:00:00.000-0400',
  url: 'https://behiques.atlassian.net/browse/HIVE-8',
};

const ledgerList = vi.fn();
const state = () => useHiveStore.getState();

/** A promise whose resolution the test controls. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const allOk = () => {
  readJiraDetail.mockResolvedValue(ok(detail));
  readJiraComments.mockResolvedValue(ok({ comments: [comment('1')], total: 3 }));
  readJiraTransitions.mockResolvedValue(ok([transition]));
  readJiraIssue.mockResolvedValue(ok(issue));
};

beforeEach(() => {
  vi.clearAllMocks();
  state().reset();
  ledgerList.mockResolvedValue({ entries: [entry], openAsks: [], claims: {} });
  window.hive = { ledger: { list: ledgerList } } as unknown as NonNullable<Window['hive']>;
  useHiveStore.setState({
    tickets: [
      { key: 'HIVE-7', status: 'In Progress', statusCategory: 'in-progress', title: 'Open', priority: null, assignee: null },
    ],
  });
  allOk();
});

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('loadTicketDetail (HIVE-203)', () => {
  it('merges every part for a listed ticket, without re-reading the issue', async () => {
    await state().loadTicketDetail('HIVE-7');

    expect(state().ticketDetail).toMatchObject({
      key: 'HIVE-7',
      detail,
      comments: [comment('1')],
      total: 3,
      transitions: [transition],
      history: [entry],
      problems: {},
    });
    expect(typeof state().ticketDetail?.readAt).toBe('number');
    expect(readJiraComments).toHaveBeenCalledWith({ key: 'HIVE-7', newest: true });
    expect(ledgerList).toHaveBeenCalledWith({ ticket: 'HIVE-7' });
    expect(readJiraIssue).not.toHaveBeenCalled();
  });

  it('reads the issue when the key is not in the list', async () => {
    await state().loadTicketDetail('HIVE-8');

    expect(readJiraIssue).toHaveBeenCalledWith({ key: 'HIVE-8' });
    expect(state().ticketDetail?.issue).toMatchObject({ key: 'HIVE-8', title: '[BE] Remote ticket', priority: 'High' });
  });

  it('records a failed comments read without blanking the detail', async () => {
    readJiraComments.mockResolvedValue(fail('boom'));
    await state().loadTicketDetail('HIVE-7');

    expect(state().ticketDetail?.problems.comments).toBe('boom');
    expect(state().ticketDetail?.detail).toEqual(detail);
  });

  it('names a missing bridge as the problem', async () => {
    readJiraComments.mockResolvedValue(null);
    readJiraDetail.mockResolvedValue(null);
    await state().loadTicketDetail('HIVE-7');

    expect(state().ticketDetail?.problems).toEqual({ comments: BRIDGE_ERROR, detail: BRIDGE_ERROR });
  });

  it('keeps what it had when a reload of the same key fails, and clears a problem that recovered', async () => {
    readJiraDetail.mockResolvedValue(fail('first'));
    await state().loadTicketDetail('HIVE-7');
    expect(state().ticketDetail?.problems.detail).toBe('first');

    readJiraDetail.mockResolvedValue(ok(detail));
    readJiraComments.mockResolvedValue(fail('boom'));
    await state().loadTicketDetail('HIVE-7');

    expect(state().ticketDetail?.comments).toEqual([comment('1')]);
    expect(state().ticketDetail?.problems).toEqual({ comments: 'boom' });
  });

  it('drops late answers for a ticket that is no longer open', async () => {
    const late = deferred<unknown>();
    readJiraDetail.mockReturnValueOnce(late.promise);
    readJiraComments.mockReturnValueOnce(new Promise(() => undefined));
    const first = state().loadTicketDetail('HIVE-7');

    await state().loadTicketDetail('HIVE-8');
    late.resolve(fail('late'));
    await Promise.race([first, Promise.resolve()]);
    await late.promise;

    expect(state().ticketDetail).toMatchObject({ key: 'HIVE-8', detail });
    expect(state().ticketDetail?.problems).toEqual({});
  });

  it('drops a late success for a ticket that is no longer open', async () => {
    const late = deferred<unknown>();
    readJiraDetail.mockReturnValueOnce(late.promise);
    void state().loadTicketDetail('HIVE-7');

    await state().loadTicketDetail('HIVE-8');
    late.resolve(ok({ description: [], parent: null }));
    await late.promise;
    await Promise.resolve();

    expect(state().ticketDetail?.detail).toEqual(detail);
  });

  it('resets the slice when another key opens', async () => {
    await state().loadTicketDetail('HIVE-7');
    readJiraDetail.mockReturnValue(new Promise(() => undefined));
    readJiraComments.mockReturnValue(new Promise(() => undefined));
    readJiraTransitions.mockReturnValue(new Promise(() => undefined));
    readJiraIssue.mockReturnValue(new Promise(() => undefined));
    ledgerList.mockReturnValue(new Promise(() => undefined));

    void state().loadTicketDetail('HIVE-8');

    expect(state().ticketDetail).toEqual({ key: 'HIVE-8', problems: {} });
  });

  it('survives a ledger that rejects, and a missing bridge', async () => {
    ledgerList.mockRejectedValue(new Error('down'));
    await state().loadTicketDetail('HIVE-7');
    expect(state().ticketDetail?.history).toBeUndefined();

    delete (window as { hive?: unknown }).hive;
    await state().loadTicketDetail('HIVE-7');
    expect(state().ticketDetail?.detail).toEqual(detail);
  });

  it('is cleared by reset', async () => {
    await state().loadTicketDetail('HIVE-7');
    state().reset();
    expect(state().ticketDetail).toBeNull();
  });
});
