import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SwarmsSection } from '@/features/settings/components/swarms-section';
import type { SwarmsSnapshot } from '@/lib/swarms';
import { useUiStore } from '@/stores/ui-store';

import type { AccountState } from '@shared/account-contract';

import type { ShippedStatus } from '@shared/shipped-contract';
import type { SwarmFailure } from '@shared/swarm-contract';

import { shippedStatus } from '../../../support/shipped';
import { installedSwarm, swarmEntry, swarmItem, swarmListing } from '../../../support/swarms';

const h = vi.hoisted(() => ({
  snapshot: null as unknown as SwarmsSnapshot,
  agents: new Map() as ReadonlyMap<string, ShippedStatus>,
  skills: new Map() as ReadonlyMap<string, ShippedStatus>,
  account: null as AccountState | null,
}));

const swarms = vi.hoisted(() => ({
  installSwarm: vi.fn(() => Promise.resolve(true)),
  removeSwarm: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  setSwarmAutoUpdate: vi.fn(() => Promise.resolve()),
  checkSwarms: vi.fn(() => Promise.resolve()),
  loadSwarms: vi.fn(() => Promise.resolve()),
  dismissSwarmFailure: vi.fn(),
}));
const shipped = vi.hoisted(() => ({
  takeShippedPrompt: vi.fn(() => Promise.resolve(null)),
  keepShippedMine: vi.fn(() => Promise.resolve(null)),
  loadShipped: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/swarms', () => swarms);
vi.mock('@/hooks/use-swarms', () => ({ useSwarms: () => h.snapshot }));
vi.mock('@/lib/shipped', () => shipped);
vi.mock('@/hooks/use-shipped', () => ({
  useShipped: (kind: 'agents' | 'skills') => (kind === 'agents' ? h.agents : h.skills),
}));
vi.mock('@/hooks/use-account', () => ({ useAccount: () => h.account }));
const account = vi.hoisted(() => ({ signIn: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/account', () => account);

const SIGNED_IN: AccountState = { kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: 'd' };

const ACME = { id: 'org-acme', name: 'Acme' };
const FAILED: SwarmFailure = { code: 'failed', message: 'Git could not reach the repository.' };

const native = swarmItem({ entry: swarmEntry({ id: 'standard' }) });
const community = swarmItem({
  entry: swarmEntry({ id: 'kit', kind: 'community', title: 'Kit' }),
  installed: installedSwarm({ swarmId: 'kit', kind: 'community', title: 'Kit', version: '2.1.0' }),
  update: { target: '2.2.0', updating: false },
});
const organization = swarmItem({
  entry: swarmEntry({ id: 'acme', kind: 'organization', title: 'Acme Tools', org: ACME }),
  installed: installedSwarm({ swarmId: 'acme', kind: 'organization', title: 'Acme Tools', org: ACME, version: '1.0.0' }),
  update: { target: '1.1.0', updating: false },
});

function serve(over: Partial<SwarmsSnapshot> = {}): void {
  h.snapshot = {
    listing: swarmListing([native, community, organization]),
    busy: new Set(),
    removing: new Set(),
    failures: new Map(),
    lastUpdate: null,
    ...over,
  };
}

const rowOf = (title: string): HTMLElement => {
  const row = screen.getAllByRole('listitem').find((item) => within(item).queryByText(title) !== null);
  if (row === undefined) throw new Error(`no row for ${title}`);
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.agents = new Map();
  h.skills = new Map();
  h.account = SIGNED_IN;
  useUiStore.getState().reset();
  serve();
});

describe('SwarmsSection', () => {
  it('draws the header, the lede, the actions and the installed list', () => {
    render(<SwarmsSection />);

    expect(screen.getByRole('heading', { name: 'Swarms', level: 2 })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sets of agents and skills that install together and update when their publisher releases a new version. Saved under ~/.hivetty.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse swarms' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(shipped.loadShipped).toHaveBeenCalled();
  });

  it('Browse → Install opens the dialog first; Cancel installs nothing; Install installs once', async () => {
    render(<SwarmsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse swarms' }));
    const nativeGroup = screen.getByRole('region', { name: 'Native' });

    fireEvent.click(within(nativeGroup).getByRole('button', { name: 'Install' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(swarms.installSwarm).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(swarms.installSwarm).not.toHaveBeenCalled();

    fireEvent.click(within(nativeGroup).getByRole('button', { name: 'Install' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(swarms.installSwarm).toHaveBeenCalledTimes(1);
    expect(swarms.installSwarm).toHaveBeenCalledWith('standard');
  });

  it("Browse's back control returns to the list", () => {
    render(<SwarmsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse swarms' }));
    expect(screen.queryByRole('heading', { name: 'Swarms', level: 2 })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Installed swarms' }));

    expect(screen.getByRole('heading', { name: 'Swarms', level: 2 })).toBeInTheDocument();
  });

  it('Review update on a community row opens the dialog in update mode; Update installs', async () => {
    render(<SwarmsSection />);

    fireEvent.click(within(rowOf('Kit')).getByRole('button', { name: 'Review update' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Update Kit' })).toBeInTheDocument();
    expect(within(dialog).getByText('v2.1.0 → v2.2.0')).toBeInTheDocument();
    expect(swarms.installSwarm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    expect(swarms.installSwarm).toHaveBeenCalledWith('kit');
  });

  it('the open dialog follows the listing, so Update installs only what it now shows', () => {
    const { rerender } = render(<SwarmsSection />);
    fireEvent.click(within(rowOf('Kit')).getByRole('button', { name: 'Review update' }));
    expect(within(screen.getByRole('dialog')).getByText('v2.1.0 → v2.2.0')).toBeInTheDocument();

    const moved = swarmItem({
      entry: swarmEntry({
        id: 'kit',
        kind: 'community',
        title: 'Kit',
        version: '2.3.0',
        agents: [
          { name: 'builder', description: 'Builds plans.', tools: ['Read', 'Edit', 'Bash'] },
          { name: 'sneaky', description: 'Arrived in 2.3.0.', tools: ['WebFetch'] },
        ],
      }),
      installed: community.installed,
      update: { target: '2.3.0', updating: false },
    });
    serve({ listing: swarmListing([native, moved, organization]) });
    rerender(<SwarmsSection />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('v2.1.0 → v2.3.0')).toBeInTheDocument();
    expect(within(dialog).getAllByText('sneaky').length).toBeGreaterThan(0);
  });

  it('the dialog closes when its swarm leaves the listing, and installs nothing', () => {
    const { rerender } = render(<SwarmsSection />);
    fireEvent.click(within(rowOf('Kit')).getByRole('button', { name: 'Review update' }));

    serve({ listing: swarmListing([native, organization]) });
    rerender(<SwarmsSection />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(swarms.installSwarm).not.toHaveBeenCalled();
  });

  it("Browse's Review update goes through the dialog too", () => {
    render(<SwarmsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse swarms' }));

    fireEvent.click(within(screen.getByRole('region', { name: 'Community' })).getByRole('button', { name: 'Review update' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(swarms.installSwarm).not.toHaveBeenCalled();
  });

  it('Update now on a ready organization row installs with no dialog', () => {
    render(<SwarmsSection />);

    fireEvent.click(within(rowOf('Acme Tools')).getByRole('button', { name: 'Update now' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(swarms.installSwarm).toHaveBeenCalledWith('acme');
  });

  it('Try again on a failed first install asks again when this pane holds no consent for it; Dismiss forgets it', () => {
    serve({ failures: new Map([['standard', FAILED]]) });
    render(<SwarmsSection />);
    const row = rowOf('Standard');
    expect(within(row).getByText(FAILED.message)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(swarms.installSwarm).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(rowOf('Standard')).getByRole('button', { name: 'Dismiss' }));
    expect(swarms.dismissSwarmFailure).toHaveBeenCalledWith('standard');
  });

  it('Try again on a failed first install opens the dialog again, even after consent; Install in it installs once', () => {
    const { rerender } = render(<SwarmsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse swarms' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Native' })).getByRole('button', { name: 'Install' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install' }));
    expect(swarms.installSwarm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Installed swarms' }));
    serve({ failures: new Map([['standard', FAILED]]) });
    rerender(<SwarmsSection />);

    fireEvent.click(within(rowOf('Standard')).getByRole('button', { name: 'Try again' }));

    expect(screen.getByRole('dialog', { name: 'Install Standard' })).toBeInTheDocument();
    expect(swarms.installSwarm).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install' }));
    expect(swarms.installSwarm).toHaveBeenCalledTimes(2);
    expect(swarms.installSwarm).toHaveBeenLastCalledWith('standard');
  });

  it('a removal in flight reads Removing…', () => {
    serve({ busy: new Set(['kit']), removing: new Set(['kit']) });
    render(<SwarmsSection />);

    expect(within(rowOf('Kit')).getByText('Removing…')).toBeInTheDocument();
  });

  it('the switch calls setSwarmAutoUpdate', () => {
    render(<SwarmsSection />);

    fireEvent.click(within(rowOf('Kit')).getByRole('switch', { name: 'Update automatically' }));

    expect(swarms.setSwarmAutoUpdate).toHaveBeenCalledWith('kit', false);
  });

  it('a confirmed Remove calls removeSwarm, and a refusal is shown under the row', async () => {
    swarms.removeSwarm.mockResolvedValueOnce('The swarm folder is in use.');
    render(<SwarmsSection />);
    const row = rowOf('Kit');

    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(within(row).getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));

    expect(swarms.removeSwarm).toHaveBeenCalledWith('kit');
    expect(await within(rowOf('Kit')).findByText('The swarm folder is in use.')).toBeInTheDocument();
  });

  it('Check for updates calls checkSwarms and is disabled while it runs', async () => {
    let finish: () => void = () => undefined;
    swarms.checkSwarms.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<SwarmsSection />);
    const check = screen.getByRole('button', { name: 'Check for updates' });

    fireEvent.click(check);
    expect(swarms.checkSwarms).toHaveBeenCalledTimes(1);
    expect(check).toBeDisabled();

    finish();
    await waitFor(() => expect(check).toBeEnabled());
  });

  it('shows the last update line from the snapshot', () => {
    serve({ lastUpdate: { title: 'Standard', version: '1.5.0' } });
    render(<SwarmsSection />);

    expect(screen.getByText('Standard updated to v1.5.0')).toBeInTheDocument();
  });

  it('the empty state offers Browse', () => {
    serve({ listing: swarmListing([native]) });
    render(<SwarmsSection />);

    expect(screen.getByText('No swarms installed.')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Browse swarms' });
    fireEvent.click(buttons.at(-1) as HTMLElement);
    expect(screen.getByRole('heading', { name: 'Browse swarms' })).toBeInTheDocument();
  });

  it("a kept file's Take shipped prompt and Keep mine call the shipped verbs", () => {
    h.agents = new Map([['builder', shippedStatus({ name: 'builder', held: true, bodyEdited: true })]]);
    serve({ listing: swarmListing([swarmItem({ installed: installedSwarm() })]) });
    render(<SwarmsSection />);

    fireEvent.click(screen.getByRole('button', { name: '1 file kept as you edited it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take shipped prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    expect(shipped.takeShippedPrompt).toHaveBeenCalledWith({ kind: 'agents', name: 'builder' });
    expect(shipped.keepShippedMine).toHaveBeenCalledWith({ kind: 'agents', name: 'builder' });
  });

  it('draws only the header and actions while the list is loading', () => {
    serve({ listing: null });
    render(<SwarmsSection />);

    expect(screen.getByRole('heading', { name: 'Swarms', level: 2 })).toBeInTheDocument();
    expect(screen.queryByText('No swarms installed.')).toBeNull();
  });

  it('marks a busy row as updating', () => {
    serve({ busy: new Set(['kit']) });
    render(<SwarmsSection />);

    expect(within(rowOf('Kit')).getByText('Updating…')).toBeInTheDocument();
  });
});

describe('an install link (HIVE-442)', () => {
  it('opens the consent dialog for a listed swarm, installs nothing, and clears the request; Cancel installs nothing', () => {
    useUiStore.getState().setSwarmInstallRequest('standard');
    render(<SwarmsSection />);

    expect(screen.getByRole('dialog', { name: 'Install Standard' })).toBeInTheDocument();
    expect(swarms.installSwarm).not.toHaveBeenCalled();
    expect(useUiStore.getState().swarmInstallRequest).toBeNull();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(swarms.installSwarm).not.toHaveBeenCalled();
  });

  it('clears the request for a swarm already installed, and opens no dialog', () => {
    useUiStore.getState().setSwarmInstallRequest('kit');
    render(<SwarmsSection />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useUiStore.getState().swarmInstallRequest).toBeNull();
  });

  it('signed out: asks to sign in and keeps the request; signing in reads the list again', () => {
    h.account = { kind: 'signed-out' };
    serve({ listing: swarmListing([], 'none') });
    useUiStore.getState().setSwarmInstallRequest('standard');
    const { rerender } = render(<SwarmsSection />);

    expect(screen.getByText('Sign in to install this swarm.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(account.signIn).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().swarmInstallRequest).toBe('standard');
    expect(swarms.loadSwarms).not.toHaveBeenCalled();

    h.account = SIGNED_IN;
    rerender(<SwarmsSection />);

    expect(swarms.loadSwarms).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sign in to install this swarm.')).not.toBeInTheDocument();
  });

  it('waits while the account is unknown or the list is loading', () => {
    h.account = null;
    useUiStore.getState().setSwarmInstallRequest('standard');
    const { rerender } = render(<SwarmsSection />);
    expect(useUiStore.getState().swarmInstallRequest).toBe('standard');

    h.account = SIGNED_IN;
    serve({ listing: null });
    rerender(<SwarmsSection />);
    expect(useUiStore.getState().swarmInstallRequest).toBe('standard');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    serve();
    rerender(<SwarmsSection />);
    expect(screen.getByRole('dialog', { name: 'Install Standard' })).toBeInTheDocument();
  });

  it('an id the cloud does not list: a dismissible sentence, and the request is cleared', () => {
    useUiStore.getState().setSwarmInstallRequest('nope123');
    render(<SwarmsSection />);

    expect(screen.getByText("This swarm isn't available to your account.")).toBeInTheDocument();
    expect(useUiStore.getState().swarmInstallRequest).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText("This swarm isn't available to your account.")).not.toBeInTheDocument();
  });

  it('a request that arrives while the pane is open is resolved too', () => {
    render(<SwarmsSection />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => useUiStore.getState().setSwarmInstallRequest('standard'));

    expect(screen.getByRole('dialog', { name: 'Install Standard' })).toBeInTheDocument();
    expect(swarms.installSwarm).not.toHaveBeenCalled();
  });
});
