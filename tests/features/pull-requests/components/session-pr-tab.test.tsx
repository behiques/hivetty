import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionPrTab } from '@features/pull-requests/components/session-pr-tab';
import type { PrDetail } from '@shared/github-contract';
import { prKey, useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { hatchRow } from '@tests/support/hatchery';
import { prDetail, prThread } from '@tests/support/pr-detail';

const { openPath } = vi.hoisted(() => ({ openPath: vi.fn(() => Promise.resolve()) }));
vi.mock('@/hooks/use-open-file-at', () => ({ useOpenFileAt: () => ({ openPath, openResolved: vi.fn() }) }));

const row = hatchRow(
  { n: 313, title: 'History spec waits for the first page' },
  { flap: 'INCUBATING', tone: 'green', github: 'Open · checks running' },
);
const key = prKey('acme', 'incorpx-server', 313);
const load = vi.fn(() => Promise.resolve());
const live = { pr: { n: 313, state: 'open' as const, url: row.pr.url }, row };

const stage = (detail?: Partial<PrDetail>) =>
  act(() =>
    useHiveStore.setState({
      loadPrDetail: load,
      prDetails:
        detail === undefined
          ? {}
          : { [key]: { key, state: 'ok', detail: prDetail({ number: 313, ...detail }), readAt: 0 } },
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  useHiveStore.getState().reset();
  useUiStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionPrTab (HIVE-209)', () => {
  it('heads with number, flap and state, the title, and head → base · size', () => {
    stage({ headRef: 'fix/hive-193-history-spec', baseRef: 'main', additions: 75, deletions: 6, changedFiles: 2 });
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByTestId('session-pr-sub')).toHaveTextContent('#313 · INCUBATING · open');
    expect(screen.getByText('History spec waits for the first page')).toBeInTheDocument();
    expect(screen.getByTestId('session-pr-facts')).toHaveTextContent(
      'fix/hive-193-history-spec → main · +75 −6 · 2 files',
    );
  });

  it('before the first read: the branch and a loading line', () => {
    stage();
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByTestId('session-pr-facts')).toHaveTextContent('feat/incorp-598-fee-rule');
    expect(screen.getByRole('status', { name: 'Loading pull request' })).toBeInTheDocument();
  });

  it('a failed first read shows the problem with a retry', () => {
    act(() =>
      useHiveStore.setState({
        loadPrDetail: load,
        prDetails: { [key]: { key, state: 'failed', problem: 'gh is signed out' } },
      }),
    );
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByText('gh is signed out')).toBeInTheDocument();
  });

  it('Checks N of M, one row per check in GitHub order; none says so', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-03T10:02:10Z') });
    stage({
      checks: [
        { name: 'lint', status: 'success', startedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:00:41Z', url: null, app: null, jobId: null },
        { name: 'unit', status: 'running', startedAt: '2026-10-03T10:00:00Z', completedAt: null, url: null, app: null, jobId: null },
        { name: 'e2e', status: 'queued', startedAt: null, completedAt: null, url: null, app: null, jobId: null },
        {
          name: 'type-check',
          status: 'failure',
          startedAt: '2026-10-03T10:00:00Z',
          completedAt: '2026-10-03T10:01:02Z',
          url: null,
          app: null,
          jobId: null,
        },
      ],
    });
    const { unmount } = render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByRole('heading', { name: 'Checks 2 of 4' })).toBeInTheDocument();
    const names = screen.getAllByTestId('check-name').map((el) => el.textContent);
    expect(names).toEqual(['lint', 'unit', 'e2e', 'type-check']);
    expect(screen.getByText('41s')).toBeInTheDocument();
    expect(screen.getByText('running 2m')).toBeInTheDocument();
    expect(screen.getByText('queued')).toBeInTheDocument();
    unmount();

    stage({ checks: [] });
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByText('No checks yet')).toBeInTheDocument();
  });

  /* Async advances: the poller skips a tick while the previous read's promise is unsettled. */
  it('reads this PR on mount, again each minute, and stops when the tab goes', async () => {
    vi.useFakeTimers();
    stage({});
    const { unmount } = render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('acme', 'incorpx-server', 313);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(load).toHaveBeenCalledTimes(2);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.every((call) => (call as unknown[])[2] === 313)).toBe(true);
  });

  it('a remembered PR: last seen, Open on GitHub only, no read', () => {
    stage();
    render(
      <SessionPrTab sessionId="s1" sessionPrs={[{ pr: { n: 298, url: 'https://github.com/a/b/pull/298' }, row: null }]} />,
    );
    expect(screen.getByText('#298 · last seen')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on GitHub ›' })).toHaveAttribute(
      'href',
      'https://github.com/a/b/pull/298',
    );
    expect(screen.queryByRole('button', { name: 'Show in PRs ›' })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('Open on GitHub links out; Show in PRs opens the PR page with this row', () => {
    stage({});
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByRole('link', { name: 'Open on GitHub ›' })).toHaveAttribute('href', row.pr.url);
    fireEvent.click(screen.getByRole('button', { name: 'Show in PRs ›' }));
    expect(useUiStore.getState().prPage).toEqual({ owner: 'acme', repo: 'incorpx-server', n: 313, row });
  });
});

const shipperHolds = () =>
  act(() =>
    useHiveStore.setState((state) => ({
      ledger: [
        ...state.ledger,
        {
          id: '20261003-085000-001',
          ts: Date.parse('2026-10-03T08:50:00Z'),
          from: 'shipper',
          kind: 'post',
          body: 'PR #313 at ci',
          meta: { pr: 313, repo: 'acme/incorpx-server', stage: 'ci' },
        },
      ],
    })),
  );

const session = () =>
  act(() =>
    useHiveStore.setState((state) => ({
      entities: { ...state.entities, s1: { kind: 'session', id: 's1', project: 'incorpx', status: 'working' } as never },
    })),
  );

describe('SessionPrTab review and threads (HIVE-209)', () => {
  it('Review: the shipper while it holds the PR, in amber, then requested reviewers and verdicts', () => {
    stage({
      reviewRequests: ['acr'],
      reviews: [{ author: 'dana', state: 'APPROVED', body: '', submittedAt: '2026-10-03T09:00:00Z', url: 'https://r/1' }],
    });
    shipperHolds();
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    const rows = screen.getAllByTestId('holder').map((el) => el.textContent);
    expect(rows).toEqual(['shipper took it · checks running', 'dana approved', 'acr review requested']);
    expect(screen.getByText('took it · checks running')).toHaveClass('text-amber-text');
  });

  it('Review is not drawn when nobody holds or reviews it', () => {
    stage({});
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.queryByRole('heading', { name: 'Review' })).toBeNull();
  });

  it('Open threads: unresolved only, path:line, author and first line; a click opens the file at the line', () => {
    session();
    stage({
      threads: [
        prThread({ path: 'src/features/history/history-spec.ts', line: 42 }),
        prThread({ id: 'PRRT_2', isResolved: true }),
      ],
    });
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByRole('heading', { name: 'Open threads 1' })).toBeInTheDocument();
    const thread = screen.getByRole('button', { name: /history-spec\.ts:42/ });
    expect(thread).toHaveTextContent('acr An LLC without a registered agent passes validation.');
    fireEvent.click(thread);
    expect(openPath).toHaveBeenCalledWith('incorpx', 's1', 'src/features/history/history-spec.ts', { line: 42 });
  });

  it("no open threads: acr's promise when acr was asked, else None yet.", () => {
    stage({ reviewRequests: ['acr'] });
    const { unmount } = render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByText("None yet. acr's findings land here, each with its file and line.")).toBeInTheDocument();
    unmount();
    stage({});
    render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
    expect(screen.getByText('None yet.')).toBeInTheDocument();
  });
});

describe('SessionPrTab with several PRs', () => {
  const remembered = { pr: { n: 298, url: 'https://github.com/a/b/pull/298' }, row: null };

  describe('the chip says where the shipper has it (HIVE-411)', () => {
    const NOW = Date.UTC(2026, 10, 13, 15, 0);
    const chip = () => screen.getByRole('button', { name: /^#313/ });
    const slug = `${row.pr.owner}/${row.pr.repo}`;
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    it('draws the chip row for one PR, with the stage and how long it has been there', () => {
      stage();
      act(() =>
        useHiveStore.setState({
          ledger: [{ id: '20261113-144300-0001', ts: NOW - 17 * 60_000, from: 'shipper', kind: 'post', body: 'approval', meta: { pr: 313, repo: slug, stage: 'approval' } }],
        }),
      );
      render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
      expect(screen.getByRole('group', { name: 'Pull requests' })).toContainElement(chip());
      expect(chip()).toHaveTextContent('#313');
      expect(chip()).toHaveTextContent('approval · 17m');
    });

    it('says merged once the PR row is merged', () => {
      stage();
      const merged = { ...live, row: { ...row, pr: { ...row.pr, state: 'merged' as const } } };
      render(<SessionPrTab sessionId="s1" sessionPrs={[merged]} />);
      expect(chip()).toHaveTextContent('merged');
    });

    it('says handed over when a ship ask names the PR and no stage has landed', () => {
      stage();
      act(() =>
        useHiveStore.setState({
          ledger: [{ id: '20261113-145900-0001', ts: NOW - 60_000, from: 's1', to: 'shipper', kind: 'ask', ref: 'a9', body: 'Ship PR #313', meta: { pr: 313, repo: slug, key: `ship:${slug}#313` } }],
        }),
      );
      render(<SessionPrTab sessionId="s1" sessionPrs={[live]} />);
      expect(chip()).toHaveTextContent('handed over');
    });

    it('a remembered PR shows its number only', () => {
      stage();
      render(<SessionPrTab sessionId="s1" sessionPrs={[{ pr: { n: 298, url: 'https://github.com/a/b/pull/298' }, row: null }]} />);
      expect(screen.getByRole('button', { name: '#298' })).toHaveTextContent(/^#298$/);
    });
  });

  it('draws a chip per PR, the first chosen, and a chip click shows that PR', () => {
    stage();
    render(<SessionPrTab sessionId="s1" sessionPrs={[live, remembered]} />);
    const picker = screen.getByRole('group', { name: 'Pull requests' });
    const first = screen.getByRole('button', { name: '#313' });
    const second = screen.getByRole('button', { name: '#298' });
    expect(picker).toContainElement(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('session-pr-sub')).toHaveTextContent('#313');

    fireEvent.click(second);

    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('#298 · last seen')).toBeInTheDocument();
    expect(screen.queryByTestId('session-pr-sub')).toBeNull();
  });

  it('falls back to the first when the picked PR has left the list', () => {
    stage();
    act(() => useUiStore.getState().setPrPick('s1', 'https://github.com/a/b/pull/1'));
    render(<SessionPrTab sessionId="s1" sessionPrs={[live, remembered]} />);
    expect(screen.getByRole('button', { name: '#313' })).toHaveAttribute('aria-pressed', 'true');
  });
});
