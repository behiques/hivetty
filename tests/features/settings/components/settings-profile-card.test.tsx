import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsProfileCard } from '@features/settings/components/settings-profile-card';

const account = vi.hoisted(() => ({ current: null as unknown }));
const licence = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@hooks/use-account', () => ({ useAccount: () => account.current }));
vi.mock('@hooks/use-licence', () => ({ useLicence: () => licence.current }));

const NOW = new Date('2026-11-07T12:00:00Z').getTime();
const DAY_S = 86_400;
const terms = {
  plan: 'team',
  features: [],
  limits: { devices: 3 },
  exp: NOW / 1000 + 7 * DAY_S,
  iat: NOW / 1000,
};
const signedIn = (name: string, email = 'ada@example.com') => ({
  kind: 'signed-in',
  name,
  email,
});

function renderCard(props: Partial<Parameters<typeof SettingsProfileCard>[0]> = {}) {
  const onOpen = vi.fn();
  const onKeyDown = vi.fn();
  render(<SettingsProfileCard active={false} onOpen={onOpen} onKeyDown={onKeyDown} {...props} />);
  return { onOpen, onKeyDown, card: screen.getByRole('button') };
}

describe('SettingsProfileCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    account.current = null;
    licence.current = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('signed out: a placeholder, "Account" and "Not signed in"', () => {
    const { card } = renderCard();
    expect(card).toHaveAccessibleName('Account');
    expect(card).toHaveTextContent('?');
    expect(card).toHaveTextContent('Account');
    expect(card).toHaveTextContent('Not signed in');
  });

  it('signed in on a plan: the name, its initial and the plan line', () => {
    account.current = signedIn('Ada Lovelace');
    licence.current = { kind: 'licensed', ...terms };
    const { card } = renderCard();
    expect(card).toHaveAccessibleName('Account, Ada Lovelace');
    expect(card).toHaveTextContent('A');
    expect(card).toHaveTextContent('Ada Lovelace');
    expect(card).toHaveTextContent('Team');
    expect(card).not.toHaveTextContent('Not signed in');
  });

  it('a trial shows the days left', () => {
    account.current = signedIn('Ada Lovelace');
    licence.current = {
      kind: 'licensed',
      ...terms,
      trialEnds: NOW / 1000 + 2.5 * DAY_S,
    };
    renderCard();
    expect(screen.getByText('Team trial · 3 days left')).toBeInTheDocument();
  });

  it('no name falls back to the email, and no plan to "Account and plan"', () => {
    account.current = signedIn('', 'grace@example.com');
    licence.current = { kind: 'unlicensed' };
    const { card } = renderCard();
    expect(card).toHaveAccessibleName('Account, grace@example.com');
    expect(card).toHaveTextContent('grace@example.com');
    expect(card).toHaveTextContent('Account and plan');
  });

  it('is the nav row for the account panes: current and tabbable only when active', () => {
    const { card } = renderCard();
    expect(card).toHaveAttribute('data-pane', 'account-devices');
    expect(card).not.toHaveAttribute('aria-current');
    expect(card).toHaveAttribute('tabindex', '-1');
  });

  it('active: aria-current page and tabindex 0', () => {
    const { card } = renderCard({ active: true });
    expect(card).toHaveAttribute('aria-current', 'page');
    expect(card).toHaveAttribute('tabindex', '0');
  });

  it('a click opens the centre and keys go to the nav handler', async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    const { card, onOpen, onKeyDown } = renderCard({ active: true });
    await user.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0]?.[0]).toMatchObject({ key: 'ArrowDown' });
  });
});
