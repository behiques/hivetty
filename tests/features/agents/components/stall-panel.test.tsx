import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSummary } from '@shared/agent-contract';
import type { LedgerEntry } from '@shared/ledger-contract';

import { age, StallPanel } from '@features/agents/components/stall-panel';
import { useHiveStore } from '@stores/hive-store';
import { notif } from '@tests/support/notifications';

/** The stall panel (HIVE-411): every owed ask, refused wake, open card and stale claim, read only. */

const NOW = Date.UTC(2026, 10, 13, 15, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const openAsk: LedgerEntry = { id: '20261113-141900-0001', ts: NOW - 41 * MIN, from: 'sess-1b', to: 'builder', kind: 'ask', ref: 'a26', body: 'Build HIVE-411' };
const acceptedAsk: LedgerEntry = { id: '20261113-130600-0001', ts: NOW - 114 * MIN, from: 'sess-0d', to: 'shipper', kind: 'ask', ref: 'a31', body: 'Ship PR #40' };
const accept: LedgerEntry = { id: '20261113-130800-0001', ts: NOW - 112 * MIN, from: 'shipper', to: 'sess-0d', kind: 'post', thread: acceptedAsk.id, body: 'ok', meta: { accepted: true } };
const staleClaim: LedgerEntry = { id: '20261111-000000-0001', ts: NOW - 2 * DAY, from: 'sess-1c', kind: 'claim', body: '', meta: { task: 'HIVE-393' } };

const agent = (name: string, over: Partial<AgentSummary> = {}): AgentSummary => ({
  name, description: 'x', icon: 'Robot', status: 'sleeping', wake: { on: [] }, mcp: [], tools: [], rotateAfter: 50, runs: [], ...over,
});

const group = (name: string) => within(screen.getByRole('region', { name }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useHiveStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StallPanel', () => {
  it('lists what every ask, wake, card and claim is waiting on', () => {
    act(() => {
      useHiveStore.getState().hydrateAgents([
        agent('reviewer', { refused: [{ lane: 'standing', reason: 'budget', at: NOW - 3 * MIN, queued: 1 }] }),
      ]);
      useHiveStore.getState().hydrateNotifs([
        { ...notif({ id: 'p1', kind: 'agent.permission', title: 'Allow Bash?', action: { type: 'ask', thread: 'p1' } }), subject: 'shipper', createdAt: NOW - 17 * MIN },
      ]);
      useHiveStore.setState({ ledger: [staleClaim, acceptedAsk, accept, openAsk] });
    });
    render(<StallPanel />);

    expect(screen.getByRole('heading', { name: 'Stalls' })).toBeInTheDocument();

    const open = within(group('Open asks').getByText('a26').closest('tr') as HTMLElement);
    expect(open.getByText('open')).toBeInTheDocument();
    expect(open.getAllByText('41m')).toHaveLength(2);

    const accepted = within(group('Open asks').getByText('a31').closest('tr') as HTMLElement);
    expect(accepted.getByText('accepted')).toBeInTheDocument();
    expect(accepted.getByText('1h 52m')).toBeInTheDocument();
    expect(accepted.getByText('2m')).toBeInTheDocument();

    expect(group('Refused wakes').getByText('reviewer')).toBeInTheDocument();
    expect(group('Refused wakes').getByText('budget')).toBeInTheDocument();
    expect(group('Refused wakes').getByText(/1 queued/)).toBeInTheDocument();

    expect(group('Permission cards').getByText('shipper')).toBeInTheDocument();
    expect(group('Permission cards').getByText('17m')).toBeInTheDocument();

    expect(group('Stale claims').getByText('HIVE-393')).toBeInTheDocument();
    expect(group('Stale claims').getByText(/sess-1c/)).toBeInTheDocument();
  });

  it('says None in every empty group', () => {
    render(<StallPanel />);
    for (const name of ['Open asks', 'Refused wakes', 'Permission cards', 'Stale claims']) {
      expect(group(name).getByText('None')).toBeInTheDocument();
    }
  });
});

describe('age', () => {
  it('says minutes, hours and minutes, then days', () => {
    expect(age(-5)).toBe('0m');
    expect(age(41 * MIN)).toBe('41m');
    expect(age(112 * MIN)).toBe('1h 52m');
    expect(age(3 * DAY + 5 * MIN)).toBe('3d');
  });
});
