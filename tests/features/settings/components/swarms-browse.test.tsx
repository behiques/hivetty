import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SwarmsBrowse } from '@/features/settings/components/swarms-browse';

import type { AccountState } from '@shared/account-contract';
import type { SwarmFailure, SwarmListing } from '@shared/swarm-contract';

import { installedSwarm, swarmEntry, swarmItem, swarmListing } from '../../../support/swarms';

const account = vi.hoisted(() => ({ current: null as AccountState | null }));
const signIn = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
vi.mock('@/hooks/use-account', () => ({ useAccount: () => account.current }));
vi.mock('@/lib/account', () => ({ signIn }));

const IN: AccountState = { kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: 'd' };

const native = swarmItem({
  entry: swarmEntry({ id: 'standard', title: 'Standard', version: '1.4.0' }),
});
const zeta = swarmItem({
  entry: swarmEntry({ id: 'zeta-kit', kind: 'organization', title: 'Zeta Kit', org: { id: 'o2', name: 'Zeta' }, version: null }),
});
const acme = swarmItem({
  entry: swarmEntry({
    id: 'acme-tools',
    kind: 'organization',
    title: 'Acme Tools',
    org: { id: 'o1', name: 'Acme' },
    skills: [{ name: 'deploy-acme', description: 'Ships it.' }],
  }),
  installed: installedSwarm({ swarmId: 'acme-tools', kind: 'organization' }),
});
const community = swarmItem({
  entry: swarmEntry({ id: 'kit', kind: 'community', title: 'Kit', publisher: 'Jane' }),
  installed: installedSwarm({ swarmId: 'kit', kind: 'community', version: '2.1.0' }),
  update: { target: '2.2.0', updating: false },
});
const LISTING = swarmListing([community, zeta, acme, native]);

function renderBrowse(
  listing: SwarmListing | null = LISTING,
  busy: ReadonlySet<string> = new Set(),
  failures: ReadonlyMap<string, SwarmFailure> = new Map(),
) {
  const calls = { onBack: vi.fn(), onInstall: vi.fn(), onReview: vi.fn(), onRetry: vi.fn() };
  render(<SwarmsBrowse listing={listing} busy={busy} failures={failures} {...calls} />);
  return calls;
}

const groupLabels = (): string[] =>
  screen.queryAllByRole('region').map((region) => region.getAttribute('aria-label') ?? '');

beforeEach(() => {
  account.current = IN;
  signIn.mockClear();
});

describe('SwarmsBrowse', () => {
  it('draws the back control, the heading and the search box', () => {
    const calls = renderBrowse();

    expect(screen.getByRole('heading', { name: 'Browse swarms' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search swarms, publishers, agents and skills' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Installed swarms' }));
    expect(calls.onBack).toHaveBeenCalledTimes(1);
  });

  it('groups Native, the organizations by name, then Community', () => {
    renderBrowse();

    expect(groupLabels()).toEqual(['Native', 'Acme', 'Zeta', 'Community']);
  });

  it('a row shows its badge, publisher, counts, version and description', () => {
    renderBrowse();

    const row = within(screen.getByRole('region', { name: 'Native' })).getByRole('listitem');
    expect(within(row).getByText('Standard')).toBeInTheDocument();
    expect(within(row).getByText('Native')).toBeInTheDocument();
    expect(within(row).getByText('HiveTTY · 1 agent · 1 skill · v1.4.0')).toBeInTheDocument();
    expect(within(row).getByText('The agents and skills most work needs.')).toBeInTheDocument();
  });

  it('leaves the version out when the row has none', () => {
    renderBrowse();

    const row = within(screen.getByRole('region', { name: 'Zeta' })).getByRole('listitem');
    expect(within(row).getByText('HiveTTY · 1 agent · 1 skill')).toBeInTheDocument();
  });

  it('a query matching only a skill name leaves one row and hides the other groups', () => {
    renderBrowse();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'deploy-acme' } });

    expect(groupLabels()).toEqual(['Acme']);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('says so when nothing matches, and clearing brings the groups back', () => {
    renderBrowse();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing-here' } });
    expect(screen.getByText('No swarms match “nothing-here”.')).toBeInTheDocument();
    expect(groupLabels()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(groupLabels()).toHaveLength(4);
  });

  it('Install on a swarm that is not installed', () => {
    const calls = renderBrowse();

    const row = within(screen.getByRole('region', { name: 'Native' })).getByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: 'Install' }));

    expect(calls.onInstall).toHaveBeenCalledWith(native);
  });

  it('Installed with a dot for an installed swarm', () => {
    renderBrowse();

    const row = within(screen.getByRole('region', { name: 'Acme' })).getByRole('listitem');
    expect(within(row).getByText('Installed')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('Review update for an installed community swarm with an update', () => {
    const calls = renderBrowse();

    const row = within(screen.getByRole('region', { name: 'Community' })).getByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: 'Review update' }));

    expect(calls.onReview).toHaveBeenCalledWith(community);
  });

  it('Updating… while busy', () => {
    renderBrowse(LISTING, new Set(['standard']));

    const row = within(screen.getByRole('region', { name: 'Native' })).getByRole('listitem');
    expect(within(row).getByText('Updating…')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('signed out: asks to sign in, whatever the listing says', () => {
    account.current = { kind: 'signed-out' };
    renderBrowse(swarmListing([], 'none'));

    expect(screen.getByText('Sign in to browse swarms.')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load swarms.")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("signed in and the source is none: couldn't load, with Try again", () => {
    const calls = renderBrowse(swarmListing([], 'none'));

    expect(screen.getByText("Couldn't load swarms.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(calls.onRetry).toHaveBeenCalledTimes(1);
  });

  it('signed in and the source is the cache: the list renders', () => {
    renderBrowse(swarmListing([native], 'cache'));

    expect(groupLabels()).toEqual(['Native']);
  });

  it('still loading: only the heading', () => {
    renderBrowse(null);

    expect(screen.getByRole('heading', { name: 'Browse swarms' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText("Couldn't load swarms.")).toBeNull();
  });

  it('the account not read yet: only the heading', () => {
    account.current = null;
    renderBrowse();

    expect(screen.queryByText('Sign in to browse swarms.')).toBeNull();
    expect(groupLabels()).toEqual([]);
  });

  it('a failed install started here shows its message and Try again on the row', () => {
    const failed: SwarmFailure = { code: 'failed', message: 'Git could not reach the repository.' };
    const calls = renderBrowse(LISTING, new Set(), new Map([['standard', failed]]));
    const group = screen.getByRole('region', { name: 'Native' });

    expect(within(group).getByText(failed.message)).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Install' })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Try again' }));
    expect(calls.onInstall).toHaveBeenCalledTimes(1);
  });

  it('an installed swarm with a ready update or a failed one offers the update, not a green Installed', () => {
    const ready = swarmItem({
      entry: swarmEntry({ id: 'acme-tools', kind: 'organization', title: 'Acme Tools', org: { id: 'o1', name: 'Acme' } }),
      installed: installedSwarm({ swarmId: 'acme-tools', kind: 'organization', version: '1.0.0' }),
      update: { target: '1.4.0', updating: false },
    });
    const failedUpdate = swarmItem({
      installed: installedSwarm({ lastError: { code: 'failed', message: 'No.' } }),
    });
    const calls = renderBrowse(swarmListing([ready, failedUpdate]));

    expect(screen.queryByText('Installed')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: 'Update now' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(calls.onReview).toHaveBeenCalledTimes(1);
  });
});
