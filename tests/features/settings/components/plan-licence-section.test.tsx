import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanLicenceSection } from '@features/settings/components/plan-licence-section';

const licence = vi.hoisted(() => ({ current: null as unknown }));
const refreshLicence = vi.hoisted(() => vi.fn());
const openAccountWeb = vi.hoisted(() => vi.fn());
const readBilling = vi.hoisted(() => vi.fn());
const openBilling = vi.hoisted(() => vi.fn());
const readPayments = vi.hoisted(() => vi.fn());
const openInvoice = vi.hoisted(() => vi.fn());
const activeOrg = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@hooks/use-licence', () => ({ useLicence: () => licence.current }));
vi.mock('@hooks/use-orgs', () => ({ useActiveOrg: () => activeOrg.current }));
vi.mock('@lib/licence', async (real) => ({ ...(await real<object>()), refreshLicence }));
vi.mock('@lib/account', () => ({ openAccountWeb, openBilling, readBilling, readPayments, openInvoice }));

const NOW = new Date('2026-11-07T12:00:00Z').getTime();
const DAY_S = 86_400;
const terms = { plan: 'team', features: [], limits: { devices: 3, runners: 5 }, exp: NOW / 1000 + 7 * DAY_S, iat: NOW / 1000 };

describe('PlanLicenceSection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    refreshLicence.mockReset().mockResolvedValue(null);
    openAccountWeb.mockReset().mockResolvedValue({ ok: true });
    readBilling.mockReset().mockResolvedValue(null);
    openBilling.mockReset().mockResolvedValue({ ok: true });
    readPayments.mockReset().mockResolvedValue(null);
    activeOrg.current = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('signed out, or the browser target: one sentence and no buttons', () => {
    licence.current = null;
    render(<PlanLicenceSection />);
    expect(screen.getByText('Sign in to see your plan.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    // Nothing to bill a signed-out Mac for.
    expect(readBilling).not.toHaveBeenCalled();
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

  describe('the subscription, from the cloud (the Account center)', () => {
    const SUB = { plan: 'team', status: 'active', interval: 'month', seats: 10, renewsAt: '2026-12-01T00:00:00.000Z', cancelAtPeriodEnd: false };

    it('asks for the active org, then shows seats in use of total, the period and the renewal', async () => {
      activeOrg.current = { id: 'org-acme', name: 'Acme', role: 'Owner', seat: true, plan: 'team', personal: false };
      readBilling.mockResolvedValue({ orgId: 'org-acme', subscription: SUB, canManage: true, seated: 6 });
      licence.current = { kind: 'licensed', ...terms };
      render(<PlanLicenceSection />);

      const group = (await screen.findByRole('heading', { name: 'Subscription' })).closest('section')!;
      expect(readBilling).toHaveBeenCalledWith('org-acme');
      expect(within(group).getByText('Seats').nextSibling).toHaveTextContent('6 of 10 in use');
      expect(within(group).getByRole('meter', { name: 'Seats in use' })).toHaveAttribute('aria-valuenow', '6');
      expect(within(group).getByText('Billed').nextSibling).toHaveTextContent('Monthly');
      expect(within(group).getByText('Status').nextSibling).toHaveTextContent('Active');
      expect(within(group).getByText('Renews on').nextSibling).toHaveTextContent(/2026/);

      // Stripe's portal for this org, through main (which falls back to the plan page itself).
      await userEvent.click(within(group).getByRole('button', { name: 'Manage billing' }));
      expect(openBilling).toHaveBeenCalledWith('org-acme');
      expect(openAccountWeb).not.toHaveBeenCalled();
      // The card and invoices are read for the same org.
      expect(readPayments).toHaveBeenCalledWith('org-acme');
    });

    it("switching org starts the Payment section afresh: the last org's invoice error goes", async () => {
      const invoice = {
        id: 'in_1',
        number: 'A-0001',
        created: '2026-11-01T12:00:00.000Z',
        total: 1200,
        currency: 'usd',
        status: 'paid',
        pdfUrl: null,
        hostedUrl: 'https://invoice.stripe.com/i/1',
      };
      readPayments.mockResolvedValue({ card: null, invoices: [invoice] });
      openInvoice.mockResolvedValue({ error: "The browser didn't open." });
      activeOrg.current = { id: 'org-a', name: 'A', role: 'Owner', seat: true, plan: 'team', personal: false };
      licence.current = { kind: 'licensed', ...terms };
      const { rerender } = render(<PlanLicenceSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'View A-0001' }));
      expect(await screen.findByText("The browser didn't open.")).toBeInTheDocument();

      activeOrg.current = { id: 'org-b', name: 'B', role: 'Owner', seat: true, plan: 'team', personal: false };
      rerender(<PlanLicenceSection />);
      await waitFor(() => expect(readPayments).toHaveBeenCalledWith('org-b'));
      expect(await screen.findByRole('button', { name: 'View A-0001' })).toBeInTheDocument();
      expect(screen.queryByText("The browser didn't open.")).not.toBeInTheDocument();
    });

    it('Manage billing that cannot open says why in one line', async () => {
      readBilling.mockResolvedValue({ orgId: 'org-me', subscription: SUB, canManage: true, seated: 1 });
      openBilling.mockResolvedValue({ error: 'Sign in to HiveTTY first.' });
      licence.current = { kind: 'licensed', ...terms };
      render(<PlanLicenceSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'Manage billing' }));
      expect(await screen.findByText('Sign in to HiveTTY first.')).toBeInTheDocument();
    });

    it('a plan set to cancel says when it ends', async () => {
      readBilling.mockResolvedValue({ orgId: 'org-me', subscription: { ...SUB, cancelAtPeriodEnd: true, interval: 'year' }, canManage: true, seated: 1 });
      licence.current = { kind: 'licensed', ...terms };
      render(<PlanLicenceSection />);

      const group = (await screen.findByRole('heading', { name: 'Subscription' })).closest('section')!;
      expect(readBilling).toHaveBeenCalledWith(undefined);
      expect(within(group).getByText('Ends on')).toBeInTheDocument();
      expect(within(group).queryByText('Renews on')).toBeNull();
      expect(within(group).getByText('Billed').nextSibling).toHaveTextContent('Yearly');
    });

    it('nothing from the cloud, or no subscription: the licence alone, from the lease', async () => {
      licence.current = { kind: 'licensed', ...terms };
      const { unmount } = render(<PlanLicenceSection />);
      await waitFor(() => expect(readBilling).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('heading', { name: 'Subscription' })).toBeNull();
      expect(screen.getByText('Works offline until')).toBeInTheDocument();
      unmount();

      readBilling.mockResolvedValue({ orgId: 'org-me', subscription: null, canManage: false, seated: 1 });
      render(<PlanLicenceSection />);
      await waitFor(() => expect(readBilling).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('heading', { name: 'Subscription' })).toBeNull();
    });
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
