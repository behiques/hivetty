import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountMenu } from '@features/account/components/account-menu';
import { useUiStore } from '@stores/ui-store';

const account = vi.hoisted(() => ({ current: null as unknown }));
const licence = vi.hoisted(() => ({ current: null as unknown }));
const openAccountWeb = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
vi.mock('@hooks/use-account', () => ({ useAccount: () => account.current }));
vi.mock('@hooks/use-licence', () => ({ useLicence: () => licence.current }));
vi.mock('@lib/account', async (real) => ({ ...(await real<object>()), openAccountWeb, signOut }));

const IN = { kind: 'signed-in', email: 'ana@example.com', name: 'Ana Ruiz', deviceId: 'd' };

describe('AccountMenu (HIVE-265)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    openAccountWeb.mockReset().mockResolvedValue({ ok: true });
    signOut.mockReset().mockResolvedValue(undefined);
    account.current = IN;
    licence.current = { kind: 'licensed', plan: 'team', features: [], limits: {}, exp: 2e9, iat: 1.9e9 };
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

  it('Settings… opens Account & devices', async () => {
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings…' }));
    expect(useUiStore.getState()).toMatchObject({ settings: true, settingsSection: 'account-devices' });
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
});
