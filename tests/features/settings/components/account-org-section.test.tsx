import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountOrgSection } from '@features/settings/components/account-org-section';

const active = vi.hoisted(() => ({ org: undefined as unknown }));
const openAccountWeb = vi.hoisted(() => vi.fn());
vi.mock('@hooks/use-orgs', () => ({ useActiveOrg: () => active.org }));
vi.mock('@lib/account', async (real) => ({ ...(await real<object>()), openAccountWeb }));

const ACME = { id: 'org-acme', name: 'Acme', role: 'Admin', seat: true, plan: 'team', status: 'active', personal: false };

describe('AccountOrgSection (HIVE-291)', () => {
  beforeEach(() => {
    active.org = ACME;
    openAccountWeb.mockReset().mockResolvedValue({ ok: true });
  });

  it('shows the name, your role, the seat and the plan', () => {
    render(<AccountOrgSection />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Seated')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
  });

  it('Manage members and seats opens /admin?org=<id> for an Owner, Admin or Billing (D1)', async () => {
    render(<AccountOrgSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Manage members and seats' }));
    expect(openAccountWeb).toHaveBeenCalledWith('/admin?org=org-acme');
  });

  it('a Member gets no manage button; no seat and no plan read as such', () => {
    active.org = { ...ACME, role: 'Member', seat: false, plan: null };
    render(<AccountOrgSection />);
    expect(screen.queryByRole('button', { name: 'Manage members and seats' })).toBeNull();
    expect(screen.getByText('No seat')).toBeInTheDocument();
    expect(screen.getByText('No plan')).toBeInTheDocument();
  });

  it.each([
    ['no active org', undefined],
    ['a personal Solo org', { ...ACME, personal: true, plan: 'solo' }],
  ])('with %s: the empty state, never hidden (D3)', (_label, org) => {
    active.org = org;
    render(<AccountOrgSection />);
    expect(screen.getByText("You're not in a team organisation.")).toBeInTheDocument();
  });
});
