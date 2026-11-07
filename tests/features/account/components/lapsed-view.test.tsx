import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LapsedView } from '@features/account/components/lapsed-view';

const readPaused = vi.hoisted(() => vi.fn());
const refreshLicence = vi.hoisted(() => vi.fn());
const choose = vi.hoisted(() => ({ waiting: false, error: null as string | null, start: vi.fn(), cancel: vi.fn() }));
vi.mock('@lib/licence', async (real) => ({ ...(await real<object>()), readPaused, refreshLicence }));
vi.mock('@lib/account', () => ({ signOut: vi.fn(), signIn: vi.fn(), signInWithCode: vi.fn(), cancelSignIn: vi.fn() }));
vi.mock('@features/account/hooks/use-choose-plan', () => ({ useChoosePlan: () => choose }));

const lapsed = (reason: string, extra = {}) => ({
  kind: 'lapsed' as const,
  reason: reason as never,
  email: 'ana@example.com',
  ...extra,
});

beforeEach(() => {
  readPaused.mockReset().mockResolvedValue({ sessions: ['api', 'web', 'notes'], agents: ['shipper'] });
  refreshLicence.mockReset().mockResolvedValue(null);
  Object.assign(choose, { waiting: false, error: null });
  choose.start.mockReset();
});

describe('LapsedView (HIVE-265)', () => {
  it.each([
    ['trial_ended', 'Your trial has ended', 'Choose a plan'],
    ['plan_cancelled', 'Your plan has ended', 'Choose a plan'],
    ['payment_failed', 'Your payment failed', 'Update payment method'],
    ['seat_removed', 'Your seat was removed', 'Choose a plan'],
    ['offline', "Can't reach HiveTTY", 'Retry'],
    ['unknown', 'Your licence has lapsed', 'Retry'],
  ])('%s: "%s" with %s', async (reason, heading, action) => {
    render(<LapsedView view={lapsed(reason)} />);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: action }));
    if (action === 'Retry') expect(refreshLicence).toHaveBeenCalled();
    else expect(choose.start).toHaveBeenCalled();
  });

  it('offline says when it last checked', () => {
    const now = Date.now();
    render(<LapsedView view={lapsed('offline', { checkedAt: Math.floor(now / 1000) - 120 })} />);
    expect(screen.getByText('Last checked 2 min ago')).toBeInTheDocument();
  });

  it('the paused line counts, and Details expands the names inline', async () => {
    render(<LapsedView view={lapsed('trial_ended')} />);
    expect(await screen.findByText('Paused: 3 sessions, 1 agent')).toBeInTheDocument();
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(details);
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('api · session')).toBeInTheDocument();
    expect(screen.getByText('shipper · agent')).toBeInTheDocument();
  });

  it('nothing paused, or no bridge: no paused line', async () => {
    readPaused.mockResolvedValue({ sessions: [], agents: [] });
    const { unmount } = render(<LapsedView view={lapsed('trial_ended')} />);
    await Promise.resolve();
    expect(screen.queryByText(/^Paused:/)).toBeNull();
    unmount();
    readPaused.mockResolvedValue(null);
    render(<LapsedView view={lapsed('trial_ended')} />);
    await Promise.resolve();
    expect(screen.queryByText(/^Paused:/)).toBeNull();
  });

  it('Choose a plan waiting replaces the action', () => {
    choose.waiting = true;
    render(<LapsedView view={lapsed('trial_ended')} />);
    expect(screen.getByText('Finish in your browser…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose a plan' })).toBeNull();
  });

  it('the footer is email · Sign out · Quit', () => {
    render(<LapsedView view={lapsed('trial_ended')} />);
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quit' })).toBeInTheDocument();
  });
});
