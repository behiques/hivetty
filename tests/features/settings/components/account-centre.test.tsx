import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountCentre } from '@features/settings/components/account-centre';
import { useUiStore } from '@stores/ui-store';

const activeOrg = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@hooks/use-orgs', () => ({ useActiveOrg: () => activeOrg.current }));
vi.mock('@features/settings/components/account-devices-section', () => ({
  AccountDevicesSection: () => <p>devices body</p>,
}));
vi.mock('@features/settings/components/plan-licence-section', () => ({
  PlanLicenceSection: () => <p>plan body</p>,
}));
vi.mock('@features/settings/components/account-org-section', () => ({
  AccountOrgSection: () => <p>org body</p>,
}));

const TEAM = { id: 'org-acme', name: 'Acme', role: 'Member', seat: true, plan: 'team', personal: false };
const PERSONAL = { id: 'org-me', name: 'Personal', role: 'Owner', seat: true, plan: 'solo', personal: true };

describe('AccountCentre (the native Account center, inside Settings)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    activeOrg.current = TEAM;
  });

  it('is one Account pane whose tabs are the three account pane ids', () => {
    render(<AccountCentre tab="plan-licence" />);

    expect(screen.getByRole('heading', { name: 'Account', level: 2 })).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: 'Account' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Profile & devices', 'Plan & billing', 'Organization']);
    expect(screen.getByRole('tab', { name: 'Plan & billing' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Plan & billing' })).toHaveTextContent('plan body');
    expect(screen.queryByText('devices body')).toBeNull();
  });

  it('a tab opens its pane id, so a deep link and a click land in the same place', async () => {
    render(<AccountCentre tab="account-devices" />);

    await userEvent.click(screen.getByRole('tab', { name: 'Organization' }));

    expect(useUiStore.getState()).toMatchObject({ settings: true, settingsSection: 'account-org' });
  });

  it('the arrows move between tabs', async () => {
    render(<AccountCentre tab="account-devices" />);
    screen.getByRole('tab', { name: 'Profile & devices' }).focus();

    await userEvent.keyboard('{ArrowRight}');

    expect(useUiStore.getState().settingsSection).toBe('plan-licence');
  });

  it('Organization is a tab only for a team org, unless a deep link asked for it', () => {
    activeOrg.current = PERSONAL;
    const { unmount } = render(<AccountCentre tab="account-devices" />);
    expect(screen.queryByRole('tab', { name: 'Organization' })).toBeNull();
    unmount();

    activeOrg.current = undefined;
    render(<AccountCentre tab="account-org" />);
    expect(screen.getByRole('tab', { name: 'Organization' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('org body');
  });
});
