import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '@/types/entity';

import { PrProperties } from '@features/pull-requests/components/pr-properties';
import { useHiveStore } from '@stores/hive-store';
import { hatchRow } from '@tests/support/hatchery';
import { prDetail } from '@tests/support/pr-detail';

const checks = [
  { name: 'lint', status: 'success' as const, startedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:00:41Z', url: 'https://ci/lint', app: 'github-actions', jobId: null },
  { name: 'integration', status: 'failure' as const, startedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:03:10Z', url: 'https://ci/int', app: 'github-actions', jobId: null },
  { name: 'e2e', status: 'running' as const, startedAt: '2026-10-03T10:00:00Z', completedAt: null, url: 'https://ci/e2e', app: 'github-actions', jobId: null },
  { name: 'build', status: 'queued' as const, startedAt: null, completedAt: null, url: 'https://ci/build', app: 'github-actions', jobId: null },
];
const row = hatchRow({ session: 'fee-rule' }, { flap: 'MUTATING', tone: 'green', github: 'Open · 2 open findings, fixer on it' });

beforeEach(() => {
  useHiveStore.getState().reset();
  useHiveStore.setState((state) => ({
    entities: {
      ...state.entities,
      'fee-rule': { kind: 'session', id: 'fee-rule', project: 'incorpx-server', ticket: 'INCORP-598', status: 'working' } as Session,
    },
  }));
});

const section = (name: string) => screen.getByRole('heading', { name }).parentElement!;

describe('PrProperties', () => {
  it("shows the flap and GitHub's words", () => {
    render(<PrProperties row={row} detail={prDetail()} />);
    expect(within(section('Status')).getByText('MUTATING')).toBeInTheDocument();
    expect(within(section('Status')).getByText('Open · 2 open findings, fixer on it')).toBeInTheDocument();
  });

  it('lists every check with its state, the failing count in red, each opening on GitHub', () => {
    render(<PrProperties row={row} detail={prDetail({ checks })} />);
    expect(screen.getByText('1 failing')).toHaveClass('text-red');
    expect(screen.getByRole('link', { name: /integration/ })).toHaveAttribute('href', 'https://ci/int');
    expect(screen.getByRole('link', { name: /integration/ })).toHaveTextContent('3m 10s');
    expect(screen.getByRole('link', { name: /e2e/ }).querySelector('[data-check="running"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: /build/ }).querySelector('[data-check="queued"]')).not.toBeNull();
  });

  it('draws a check with no page as a plain row', () => {
    render(<PrProperties row={row} detail={prDetail({ checks: [{ ...checks[0]!, url: null }] })} />);
    expect(screen.queryByRole('link', { name: /lint/ })).toBeNull();
    expect(within(section('Checks')).getByText('lint')).toBeInTheDocument();
  });

  it('lists reviewers by their latest verdict, and requested ones', () => {
    render(
      <PrProperties
        row={row}
        detail={prDetail({
          reviews: [
            { author: 'maria', state: 'COMMENTED', body: 'q', submittedAt: '2026-10-03T10:00:00Z', url: 'r1' },
            { author: 'maria', state: 'APPROVED', body: '', submittedAt: '2026-10-03T11:00:00Z', url: 'r2' },
          ],
          reviewRequests: ['dana'],
        })}
      />,
    );
    expect(within(section('Reviewers')).getByText('approved')).toBeInTheDocument();
    expect(within(section('Reviewers')).getByText('requested')).toBeInTheDocument();
  });

  it("links the session's ticket and its state", () => {
    render(<PrProperties row={row} detail={prDetail()} />);
    expect(within(section('Linked')).getByText('INCORP-598')).toBeInTheDocument();
  });

  it('draws no Linked section without a live session', () => {
    render(<PrProperties row={hatchRow()} detail={prDetail()} />);
    expect(screen.queryByRole('heading', { name: 'Linked' })).toBeNull();
  });
});
