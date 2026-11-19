import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SwarmsSection } from '@/features/settings/components/swarms-section';
import type { SwarmsSnapshot } from '@/lib/swarms';

import type { ShippedStatus } from '@shared/shipped-contract';
import type { SwarmFailure } from '@shared/swarm-contract';

import { shippedStatus } from '../../../support/shipped';
import { installedSwarm, swarmEntry, swarmItem, swarmListing } from '../../../support/swarms';

const h = vi.hoisted(() => ({
  snapshot: null as unknown as SwarmsSnapshot,
  agents: new Map() as ReadonlyMap<string, ShippedStatus>,
  skills: new Map() as ReadonlyMap<string, ShippedStatus>,
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
vi.mock('@/hooks/use-account', () => ({
  useAccount: () => ({ kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: 'd' }),
}));

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

  const consentThenFail = () => {
    const view = render(<SwarmsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse swarms' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Native' })).getByRole('button', { name: 'Install' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install' }));
    expect(swarms.installSwarm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Installed swarms' }));
    return view;
  };

  it('Try again installs with no dialog when the row is still the one consented to', () => {
    const { rerender } = consentThenFail();
    serve({ failures: new Map([['standard', FAILED]]) });
    rerender(<SwarmsSection />);

    fireEvent.click(within(rowOf('Standard')).getByRole('button', { name: 'Try again' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(swarms.installSwarm).toHaveBeenCalledTimes(2);
  });

  it('Try again reopens the dialog when the registry row moved since consent', () => {
    const { rerender } = consentThenFail();
    const moved = swarmItem({
      entry: swarmEntry({
        id: 'standard',
        version: '1.5.0',
        agents: [{ name: 'builder', description: 'Builds plans.', tools: ['Read', 'Edit', 'Bash', 'WebFetch'] }],
      }),
    });
    serve({ listing: swarmListing([moved, community, organization]), failures: new Map([['standard', FAILED]]) });
    rerender(<SwarmsSection />);

    fireEvent.click(within(rowOf('Standard')).getByRole('button', { name: 'Try again' }));

    expect(within(screen.getByRole('dialog')).getByText('WebFetch')).toBeInTheDocument();
    expect(swarms.installSwarm).toHaveBeenCalledTimes(1);
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
