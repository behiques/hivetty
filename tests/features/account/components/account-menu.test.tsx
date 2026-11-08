import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountMenu } from '@features/account/components/account-menu';
import { useUiStore } from '@stores/ui-store';

const account = vi.hoisted(() => ({ current: null as unknown }));
const licence = vi.hoisted(() => ({ current: null as unknown }));
const openAccountWeb = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const orgs = vi.hoisted(() => ({ list: [] as unknown[], active: undefined as unknown }));
const refreshOrgs = vi.hoisted(() => vi.fn());
const switchOrg = vi.hoisted(() => vi.fn());
vi.mock('@hooks/use-orgs', () => ({ useOrgs: () => orgs.list, useActiveOrg: () => orgs.active, refreshOrgs }));
vi.mock('@hooks/use-account', () => ({ useAccount: () => account.current }));
vi.mock('@hooks/use-licence', () => ({ useLicence: () => licence.current }));
vi.mock('@lib/account', async (real) => ({ ...(await real<object>()), openAccountWeb, signOut, switchOrg }));

const IN = { kind: 'signed-in', email: 'ana@example.com', name: 'Ana Ruiz', deviceId: 'd' };
const PERSONAL = { id: 'org-me', name: 'Personal', role: 'Owner', seat: true, plan: 'solo', status: 'active', personal: true };
const ACME = { id: 'org-acme', name: 'Acme', role: 'Member', seat: true, plan: 'team', status: 'active', personal: false };

describe('AccountMenu (HIVE-265)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    openAccountWeb.mockReset().mockResolvedValue({ ok: true });
    signOut.mockReset().mockResolvedValue(undefined);
    account.current = IN;
    licence.current = { kind: 'licensed', plan: 'team', features: [], limits: {}, exp: 2e9, iat: 1.9e9 };
    orgs.list = [];
    orgs.active = undefined;
    refreshOrgs.mockReset();
    switchOrg.mockReset().mockResolvedValue(null);
  });

  it('draws nothing unless signed in', () => {
    account.current = { kind: 'signed-out' };
    const { container } = render(<AccountMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the trigger is the initial; the menu shows name, email and plan', async () => {
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
  });

  it('with no name and no live licence: the email heads it, and no plan line', async () => {
    account.current = { ...IN, name: '' };
    licence.current = null;
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getAllByText('ana@example.com')).toHaveLength(2);
    expect(screen.queryByText('Team')).toBeNull();
  });

  it.each([
    ['Plan & billing…', '/account/plan'],
    ['Account…', '/account'],
  ])('%s opens %s signed in', async (item, path) => {
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: item }));
    expect(openAccountWeb).toHaveBeenCalledWith(path);
  });

  it('Settings… opens Settings without naming a pane, so it lands where the user last was', async () => {
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings…' }));
    expect(useUiStore.getState()).toMatchObject({ settings: true, settingsSection: null });
  });

  it('Sign out asks first; Cancel keeps the account, Sign out signs out', async () => {
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(screen.getByRole('dialog', { name: 'Sign out of HiveTTY Pro?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });
  it('with one org: no section and no badge; the trigger names the org (HIVE-291)', async () => {
    orgs.list = [PERSONAL];
    orgs.active = PERSONAL;
    render(<AccountMenu />);
    expect(screen.queryByText('PE')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Account, Personal' }));
    expect(screen.queryByText('Organisation')).toBeNull();
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0);
  });

  it('with two or more orgs: the badge, and a row per org with "Plan · Role", No seat and a check on the licence org (HIVE-291)', async () => {
    const xylo = { id: 'org-x', name: 'Xylo', role: 'Admin', seat: true, plan: null, status: null, personal: false };
    orgs.list = [PERSONAL, { ...ACME, seat: false }, xylo];
    orgs.active = PERSONAL;
    render(<AccountMenu />);
    expect(screen.getByText('PE')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account, Personal' }));
    expect(screen.getByText('Organisation')).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /^Personal/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: /^Acme/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Solo · Owner')).toBeInTheDocument();
    expect(screen.getByText('Team · Member')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('No seat')).toBeInTheDocument();
  });

  it('selecting a row switches to that org (HIVE-291)', async () => {
    orgs.list = [PERSONAL, ACME];
    orgs.active = PERSONAL;
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account, Personal' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Acme/ }));
    expect(switchOrg).toHaveBeenCalledWith('org-acme');
  });

  it('opening the menu refreshes the orgs (HIVE-291)', async () => {
    render(<AccountMenu />);
    expect(refreshOrgs).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(refreshOrgs).toHaveBeenCalledTimes(1);
  });

  it('the no-seat line sits under the org asked for when the lease came from another (HIVE-291 D6)', async () => {
    account.current = { ...IN, activeOrg: 'org-acme' };
    orgs.list = [PERSONAL, { ...ACME, seat: false }];
    orgs.active = PERSONAL;
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account, Personal' }));
    expect(screen.getByText('No seat in Acme, using Personal')).toBeInTheDocument();
  });

  it('no no-seat line when the lease is the org asked for (HIVE-291 D6)', async () => {
    account.current = { ...IN, activeOrg: 'org-me' };
    orgs.list = [PERSONAL, ACME];
    orgs.active = PERSONAL;
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account, Personal' }));
    expect(screen.queryByText(/^No seat in/)).toBeNull();
  });

  it.each([['Owner'], ['Admin'], ['Billing']])(
    'Manage organisation… opens /admin?org=<id> for a team %s, with one org too (HIVE-291 D1)',
    async (role) => {
      orgs.list = [{ ...ACME, role }];
      orgs.active = { ...ACME, role };
      render(<AccountMenu />);
      await userEvent.click(screen.getByRole('button', { name: 'Account, Acme' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Manage organisation…' }));
      expect(openAccountWeb).toHaveBeenCalledWith('/admin?org=org-acme');
    },
  );

  it.each([
    ['a Member of a team', { ...ACME, role: 'Member' }],
    ['the Owner of a personal Solo org', PERSONAL],
    ['no active org', undefined],
  ])('no Manage organisation… for %s (HIVE-291)', async (_label, org) => {
    orgs.list = org ? [org] : [];
    orgs.active = org;
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: /^Account/ }));
    expect(screen.queryByRole('menuitem', { name: 'Manage organisation…' })).toBeNull();
  });
});
