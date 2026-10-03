import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BRIDGE_ERROR } from '@lib/utils';
import { TICKET_DETAIL_CAP, useHiveStore } from '@stores/hive-store';
import type { JiraComment, JiraIssue, JiraIssueDetail, JiraTransition } from '@shared/jira-contract';
import type { LedgerEntry } from '@shared/ledger-contract';

/**
 * The ticket detail slice (HIVE-203), keyed by issue key (HIVE-202).
 *
 * `lib/jira` is mocked: what is under test is how each answer merges, that one
 * failed read never blanks another, that the map holds at most
 * TICKET_DETAIL_CAP tickets, and that a late answer for an evicted key is dropped.
 */

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
  readJiraLinks.mockResolvedValue(ok([]));
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
    await state().loadTicketDetail('HIVE-7', 'page');

    expect(state().ticketDetails['HIVE-7']).toMatchObject({
      key: 'HIVE-7',
      detail,
      comments: [comment('1')],
      total: 3,
      transitions: [transition],
      history: [entry],
      problems: {},
    });
    expect(typeof state().ticketDetails['HIVE-7']?.readAt).toBe('number');
    expect(readJiraComments).toHaveBeenCalledWith({ key: 'HIVE-7', newest: true });
    expect(ledgerList).toHaveBeenCalledWith({ ticket: 'HIVE-7' });
    expect(readJiraIssue).not.toHaveBeenCalled();
  });

  it('reads the issue when the key is not in the list', async () => {
    await state().loadTicketDetail('HIVE-8', 'page');

    expect(readJiraIssue).toHaveBeenCalledWith({ key: 'HIVE-8' });
    expect(state().ticketDetails['HIVE-8']?.issue).toMatchObject({
      key: 'HIVE-8',
      title: '[BE] Remote ticket',
      priority: 'High',
      issueType: 'Story',
    });
  });

  it('records a failed comments read without blanking the detail', async () => {
    readJiraComments.mockResolvedValue(fail('boom'));
    await state().loadTicketDetail('HIVE-7', 'page');

    expect(state().ticketDetails['HIVE-7']?.problems.comments).toBe('boom');
    expect(state().ticketDetails['HIVE-7']?.detail).toEqual(detail);
  });

  it('names a missing bridge as the problem', async () => {
    readJiraComments.mockResolvedValue(null);
    readJiraDetail.mockResolvedValue(null);
    await state().loadTicketDetail('HIVE-7', 'page');

    expect(state().ticketDetails['HIVE-7']?.problems).toEqual({ comments: BRIDGE_ERROR, detail: BRIDGE_ERROR });
  });

  it('keeps what it had when a reload of the same key fails, and clears a problem that recovered', async () => {
    readJiraDetail.mockResolvedValue(fail('first'));
    await state().loadTicketDetail('HIVE-7', 'page');
    expect(state().ticketDetails['HIVE-7']?.problems.detail).toBe('first');

    readJiraDetail.mockResolvedValue(ok(detail));
    readJiraComments.mockResolvedValue(fail('boom'));
    await state().loadTicketDetail('HIVE-7', 'page');

    expect(state().ticketDetails['HIVE-7']?.comments).toEqual([comment('1')]);
    expect(state().ticketDetails['HIVE-7']?.problems).toEqual({ comments: 'boom' });
  });

  it('keeps two tickets side by side (HIVE-202, D2)', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    await state().loadTicketDetail('HIVE-8', 'tab');
    expect(Object.keys(state().ticketDetails)).toEqual(['HIVE-7', 'HIVE-8']);
    expect(state().ticketDetails['HIVE-7']?.detail).toEqual(detail);
  });

  it('drops an answer for a key evicted while it was in flight', async () => {
    const late = deferred<ReturnType<typeof ok<JiraIssueDetail>>>();
    readJiraDetail.mockReturnValueOnce(late.promise);
    const pending = state().loadTicketDetail('HIVE-7', 'page');
    useHiveStore.setState({ ticketDetails: {} });
    late.resolve(ok(detail));
    await pending;
    expect(state().ticketDetails['HIVE-7']).toBeUndefined();
  });

  it(`holds at most ${String(TICKET_DETAIL_CAP)} tickets; a load or refresh makes one the newest`, async () => {
    for (let n = 1; n <= TICKET_DETAIL_CAP; n += 1) await state().loadTicketDetail(`HIVE-${String(n)}`, 'tab');
    await state().refreshTicketDetail('HIVE-1', 'tab');
    await state().loadTicketDetail('HIVE-99', 'tab');
    const keys = Object.keys(state().ticketDetails);
    expect(keys).toHaveLength(TICKET_DETAIL_CAP);
    expect(keys).toContain('HIVE-1');
    expect(keys).not.toContain('HIVE-2');
    expect(keys.at(-1)).toBe('HIVE-99');
  });

  it('refresh of a key never loaded does nothing (the poller runs before the load)', async () => {
    await state().refreshTicketDetail('HIVE-7', 'page');
    expect(state().ticketDetails).toEqual({});
    expect(readJiraDetail).not.toHaveBeenCalled();
  });

  it("'tab' does not read the ledger history; 'page' does", async () => {
    await state().loadTicketDetail('HIVE-7', 'tab');
    expect(ledgerList).not.toHaveBeenCalled();
    await state().loadTicketDetail('HIVE-8', 'page');
    expect(ledgerList).toHaveBeenCalledWith({ ticket: 'HIVE-8' });
  });

  it('survives a ledger that rejects, and a missing bridge', async () => {
    ledgerList.mockRejectedValue(new Error('down'));
    await state().loadTicketDetail('HIVE-7', 'page');
    expect(state().ticketDetails['HIVE-7']?.history).toBeUndefined();

    delete (window as { hive?: unknown }).hive;
    await state().loadTicketDetail('HIVE-7', 'page');
    expect(state().ticketDetails['HIVE-7']?.detail).toEqual(detail);
  });

  it('is cleared by reset', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    state().reset();
    expect(state().ticketDetails).toEqual({});
  });
});

describe('refreshTicketDetail (HIVE-203)', () => {
  it('re-reads detail, comments and transitions of the open ticket, not its history', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    vi.clearAllMocks();
    readJiraComments.mockResolvedValue(ok({ comments: [comment('1'), comment('2')], total: 4 }));

    await state().refreshTicketDetail('HIVE-7', 'page');

    expect(readJiraDetail).toHaveBeenCalledWith({ key: 'HIVE-7' });
    expect(readJiraComments).toHaveBeenCalledWith({ key: 'HIVE-7', newest: true });
    expect(readJiraTransitions).toHaveBeenCalledWith({ key: 'HIVE-7' });
    expect(ledgerList).not.toHaveBeenCalled();
    expect(readJiraIssue).not.toHaveBeenCalled();
    expect(state().ticketDetails['HIVE-7']).toMatchObject({ comments: [comment('1'), comment('2')], total: 4, history: [entry] });
  });

  it('re-reads the issue only when the slice holds one', async () => {
    await state().loadTicketDetail('HIVE-8', 'page');
    vi.clearAllMocks();

    await state().refreshTicketDetail('HIVE-8', 'page');

    expect(readJiraIssue).toHaveBeenCalledWith({ key: 'HIVE-8' });
  });

  it('does nothing for a key that is not open', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    vi.clearAllMocks();

    await state().refreshTicketDetail('HIVE-8', 'page');

    expect(readJiraDetail).not.toHaveBeenCalled();
    expect(Object.keys(state().ticketDetails)).toEqual(['HIVE-7']);
  });
});

describe('appendTicketComment (HIVE-203)', () => {
  it('pushes the comment and counts it', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    state().appendTicketComment('HIVE-7', comment('9'));

    expect(state().ticketDetails['HIVE-7']?.comments).toEqual([comment('1'), comment('9')]);
    expect(state().ticketDetails['HIVE-7']?.total).toBe(4);
  });

  it('starts from nothing when no comments were read', () => {
    useHiveStore.setState({ ticketDetails: { 'HIVE-7': { key: 'HIVE-7', problems: {} } } });
    state().appendTicketComment('HIVE-7', comment('9'));

    expect(state().ticketDetails['HIVE-7']).toMatchObject({ comments: [comment('9')], total: 1 });
  });

  it('ignores another key', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    const before = state().ticketDetails['HIVE-7'];
    state().appendTicketComment('HIVE-8', comment('9'));

    expect(state().ticketDetails['HIVE-7']).toBe(before);
  });
});

describe('reloadTicketTransitions (HIVE-203)', () => {
  it('replaces the transitions of the open ticket', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    const back: JiraTransition = { id: '11', name: 'Reopen', to: { name: 'To Do', statusCategory: 'todo' } };
    readJiraTransitions.mockResolvedValue(ok([back]));

    await state().reloadTicketTransitions('HIVE-7');

    expect(state().ticketDetails['HIVE-7']?.transitions).toEqual([back]);
  });

  it('does nothing for a key that is not open', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    vi.clearAllMocks();

    await state().reloadTicketTransitions('HIVE-8');

    expect(readJiraTransitions).not.toHaveBeenCalled();
  });
});

describe('setTicketDetailIssue (HIVE-203)', () => {
  it('replaces the issue the slice read for itself', async () => {
    await state().loadTicketDetail('HIVE-8', 'page');
    state().setTicketDetailIssue({ ...issue, status: 'Done', statusCategory: 'done' });

    expect(state().ticketDetails['HIVE-8']?.issue).toMatchObject({ key: 'HIVE-8', status: 'Done', statusCategory: 'done' });
  });

  it('leaves a listed ticket to the list, and ignores another key', async () => {
    await state().loadTicketDetail('HIVE-7', 'page');
    const before = state().ticketDetails['HIVE-7'];

    state().setTicketDetailIssue({ ...issue, key: 'HIVE-7' });
    state().setTicketDetailIssue(issue);

    expect(state().ticketDetails['HIVE-7']).toBe(before);
  });
});
