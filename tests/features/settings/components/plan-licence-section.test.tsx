import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanLicenceSection } from '@features/settings/components/plan-licence-section';

const licence = vi.hoisted(() => ({ current: null as unknown }));
const refreshLicence = vi.hoisted(() => vi.fn());
const openAccountWeb = vi.hoisted(() => vi.fn());
vi.mock('@hooks/use-licence', () => ({ useLicence: () => licence.current }));
vi.mock('@lib/licence', async (real) => ({ ...(await real<object>()), refreshLicence }));
vi.mock('@lib/account', () => ({ openAccountWeb }));

const NOW = new Date('2026-11-07T12:00:00Z').getTime();
const DAY_S = 86_400;
const terms = { plan: 'team', features: [], limits: { devices: 3, runners: 5 }, exp: NOW / 1000 + 7 * DAY_S };

describe('PlanLicenceSection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    refreshLicence.mockReset().mockResolvedValue(null);
    openAccountWeb.mockReset().mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('signed out, or the browser target: one sentence and no buttons', () => {
    licence.current = null;
    render(<PlanLicenceSection />);
    expect(screen.getByRole('heading', { name: 'Plan & licence', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Sign in to see your plan.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('unlicensed reads the same as signed out', () => {
    licence.current = { kind: 'unlicensed' };
    render(<PlanLicenceSection />);
    expect(screen.getByText('Sign in to see your plan.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a Team trial: the plan, days left, the limits and the expiry', () => {
    licence.current = { kind: 'licensed', ...terms, trialEnds: NOW / 1000 + 8.5 * DAY_S };
    render(<PlanLicenceSection />);
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Trial · 9 days left')).toBeInTheDocument();
    expect(screen.getByText('Devices per seat').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Runners').nextSibling).toHaveTextContent('5');
    expect(screen.getByText('Works offline until')).toBeInTheDocument();
  });

  it('one day left is singular, and no trial means no tag', () => {
    licence.current = { kind: 'licensed', ...terms, trialEnds: NOW / 1000 + 0.5 * DAY_S };
    const { unmount } = render(<PlanLicenceSection />);
    expect(screen.getByText('Trial · 1 day left')).toBeInTheDocument();
    unmount();
    licence.current = { kind: 'licensed', ...terms };
    render(<PlanLicenceSection />);
    expect(screen.queryByText(/^Trial ·/)).toBeNull();
  });

  it('runners uncapped when the lease has no runners key', () => {
    licence.current = { kind: 'licensed', ...terms, plan: 'enterprise', limits: { devices: 3 } };
    render(<PlanLicenceSection />);
    expect(screen.getByText('Runners').nextSibling).toHaveTextContent('Uncapped');
  });

  it('grace says the licence keeps working until the expiry', () => {
    licence.current = { kind: 'grace', ...terms };
    render(<PlanLicenceSection />);
    expect(screen.getByText(/Couldn't reach HiveTTY\. This licence keeps working until/)).toBeInTheDocument();
  });

  it('lapsed says why, and keeps both buttons', () => {
    licence.current = { kind: 'lapsed', reason: 'trial_ended' };
    render(<PlanLicenceSection />);
    expect(screen.getByText('Your trial has ended.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh licence' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage plan' })).toBeInTheDocument();
  });

  it('Refresh licence renews; Manage plan opens /account/plan signed in, and shows a failure', async () => {
    licence.current = { kind: 'licensed', ...terms };
    render(<PlanLicenceSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh licence' }));
    expect(refreshLicence).toHaveBeenCalledTimes(1);
    openAccountWeb.mockResolvedValueOnce({ error: "Couldn't reach HiveTTY. Try again." });
    await userEvent.click(screen.getByRole('button', { name: 'Manage plan' }));
    expect(openAccountWeb).toHaveBeenCalledWith('/account/plan');
    expect(await screen.findByText("Couldn't reach HiveTTY. Try again.")).toBeInTheDocument();
  });
});
