import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SwarmRow } from '@/features/settings/components/swarm-row';
import type { KeptFile } from '@/features/settings/lib/swarm-view';

import type { SwarmFailure, SwarmListing, SwarmListItem } from '@shared/swarm-contract';

import { shippedStatus } from '../../../support/shipped';
import { installedSwarm, swarmEntry, swarmItem } from '../../../support/swarms';

const ACME = { id: 'org-acme', name: 'Acme' };
const FAILED: SwarmFailure = { code: 'failed', message: 'Git could not reach the repository.' };

function renderRow(
  item: SwarmListItem,
  over: {
    source?: SwarmListing['source'];
    busy?: boolean;
    removing?: boolean;
    failure?: SwarmFailure;
    kept?: KeptFile[];
  } = {},
) {
  const calls = {
    onTurnOn: vi.fn(),
    onRestore: vi.fn(),
    onAction: vi.fn(),
    onDismiss: vi.fn(),
    onAutoUpdate: vi.fn(),
    onRemove: vi.fn(),
    onTake: vi.fn(),
    onKeep: vi.fn(),
  };
  render(
    <SwarmRow
      item={item}
      source={over.source ?? 'cloud'}
      busy={over.busy ?? false}
      removing={over.removing ?? false}
      failure={over.failure}
      kept={over.kept ?? []}
      {...calls}
    />,
  );
  return calls;
}

const ACTIONS = ['Update now', 'Review update', 'Try again'];
const actionsShown = (): string[] =>
  ACTIONS.filter((name) => screen.queryByRole('button', { name }) !== null);

describe('SwarmRow, one case per state', () => {
  it('current: the version, no action, the switch and Remove', () => {
    renderRow(swarmItem({ installed: installedSwarm() }));

    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Native')).toBeInTheDocument();
    expect(screen.getByText('v1.4.0 · up to date')).toBeInTheDocument();
    expect(screen.getByText('HiveTTY · 1 agent · 1 skill · 1 of 1 agent and 1 of 1 skill on')).toBeInTheDocument();
    expect(actionsShown()).toEqual([]);
    expect(screen.getByRole('switch', { name: 'Update automatically' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('ready: Update now calls onAction', () => {
    const calls = renderRow(
      swarmItem({ installed: installedSwarm({ version: '0.9.2' }), update: { target: '0.10.0', updating: false } }),
    );

    expect(screen.getByText('v0.9.2 · v0.10.0 is ready')).toBeInTheDocument();
    expect(actionsShown()).toEqual(['Update now']);
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(calls.onAction).toHaveBeenCalledTimes(1);
  });

  it('available: Review update for a community swarm', () => {
    renderRow(
      swarmItem({
        entry: swarmEntry({ kind: 'community', publisher: 'Jane' }),
        installed: installedSwarm({ kind: 'community', version: '2.1.0' }),
        update: { target: '2.2.0', updating: false },
      }),
    );

    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('v2.1.0 · v2.2.0 available')).toBeInTheDocument();
    expect(actionsShown()).toEqual(['Review update']);
  });

  it("not installed: the failure's message, Try again and Dismiss, no footer", () => {
    const calls = renderRow(swarmItem(), { failure: FAILED });

    expect(screen.getByText('Not installed')).toBeInTheDocument();
    expect(screen.getByText(FAILED.message)).toBeInTheDocument();
    expect(actionsShown()).toEqual(['Try again']);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(calls.onAction).toHaveBeenCalledTimes(1);
    expect(calls.onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('updating: no action, every control disabled', () => {
    renderRow(swarmItem({ installed: installedSwarm() }), { busy: true });

    expect(screen.getByText('Updating…')).toBeInTheDocument();
    expect(actionsShown()).toEqual([]);
    expect(screen.getByRole('switch', { name: 'Update automatically' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('removing: reads Removing…, every control disabled', () => {
    renderRow(swarmItem({ installed: installedSwarm() }), { busy: true, removing: true });

    expect(screen.getByText('Removing…')).toBeInTheDocument();
    expect(screen.queryByText('Updating…')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Update automatically' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('an update whose call was rejected shows the held message beside Update now', () => {
    renderRow(swarmItem({ installed: installedSwarm({ version: '1.3.0' }), update: { target: '1.4.0', updating: false } }), {
      failure: FAILED,
    });

    expect(screen.getByText(FAILED.message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument();
  });

  it("failed update: the installed entry's error and Update now", () => {
    renderRow(
      swarmItem({ installed: installedSwarm({ lastError: FAILED }), update: { target: '1.5.0', updating: false } }),
    );

    expect(screen.getByText('v1.4.0 · update failed')).toBeInTheDocument();
    expect(screen.getByText(FAILED.message)).toBeInTheDocument();
    expect(actionsShown()).toEqual(['Update now']);
  });

  it('failed update of a community swarm: Review update', () => {
    renderRow(
      swarmItem({
        entry: swarmEntry({ kind: 'community' }),
        installed: installedSwarm({ kind: 'community', lastError: FAILED }),
      }),
    );

    expect(actionsShown()).toEqual(['Review update']);
  });

  it('gone from an organization: the sentence, Remove, no switch', () => {
    renderRow(swarmItem({ entry: null, installed: installedSwarm({ kind: 'organization', org: ACME, version: '1.2.0' }) }));

    expect(screen.getByText('v1.2.0')).toBeInTheDocument();
    expect(screen.getByText("No longer available from Acme. It won't update.")).toBeInTheDocument();
    expect(screen.getByText('https://github.com/behiques/swarms.git · 1 agent · 1 skill · 1 of 1 agent and 1 of 1 skill on')).toBeInTheDocument();
    expect(actionsShown()).toEqual([]);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('gone, native or community: the shorter sentence', () => {
    renderRow(swarmItem({ entry: null, installed: installedSwarm() }));

    expect(screen.getByText("No longer available. It won't update.")).toBeInTheDocument();
  });

  it('the dot is decorative', () => {
    const { container } = render(
      <SwarmRow
        item={swarmItem({ installed: installedSwarm() })}
        source="cloud"
        busy={false}
        failure={undefined}
        kept={[]}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onAutoUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTake={vi.fn()}
        onKeep={vi.fn()}
        onTurnOn={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    const dot = container.querySelector('[data-dot]');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot?.className).toContain('bg-green');
  });

  it.each<[string, SwarmListItem, boolean, string]>([
    ['ready is amber', swarmItem({ installed: installedSwarm(), update: { target: '2.0.0', updating: false } }), false, 'bg-amber'],
    ['not installed is red', swarmItem(), false, 'bg-red'],
    ['updating pulses in brand', swarmItem({ installed: installedSwarm() }), true, 'animate-ccpulse'],
    ['gone is muted', swarmItem({ entry: null, installed: installedSwarm() }), false, 'bg-muted'],
  ])('dot colour: %s', (_name, item, busy, token) => {
    const { container } = render(
      <SwarmRow
        item={item}
        source="cloud"
        busy={busy}
        failure={undefined}
        kept={[]}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onAutoUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTake={vi.fn()}
        onKeep={vi.fn()}
        onTurnOn={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-dot]')?.className).toContain(token);
  });
});

describe('SwarmRow footer', () => {
  it('the switch calls onAutoUpdate(false)', () => {
    const calls = renderRow(swarmItem({ installed: installedSwarm({ autoUpdate: true }) }));

    fireEvent.click(screen.getByRole('switch', { name: 'Update automatically' }));

    expect(calls.onAutoUpdate).toHaveBeenCalledWith(false);
  });

  it("a pinned organization row reads the pin instead of the switch", () => {
    renderRow(
      swarmItem({
        entry: swarmEntry({ kind: 'organization', org: ACME, policy: 'pinned', pinnedVersion: '1.2.0' }),
        installed: installedSwarm({ kind: 'organization', org: ACME }),
      }),
    );

    expect(screen.getByText('Pinned to v1.2.0 by Acme')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('Remove asks first, and only the confirmation calls onRemove', () => {
    const calls = renderRow(swarmItem({ installed: installedSwarm() }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(calls.onRemove).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog', { name: 'Remove Standard' });
    expect(within(confirm).getByText('Remove Standard?')).toBeInTheDocument();
    expect(within(confirm).getByText('Files you edited are kept.')).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls.onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect(calls.onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('SwarmRow kept files', () => {
  const builder: KeptFile = {
    kind: 'agents',
    name: 'builder',
    status: shippedStatus({ name: 'builder', held: true, bodyEdited: true }),
  };
  const tdd: KeptFile = {
    kind: 'skills',
    name: 'tdd',
    status: shippedStatus({ kind: 'skills', name: 'tdd', held: true, bodyEdited: true }),
  };

  it('draws nothing with no kept file', () => {
    renderRow(swarmItem({ installed: installedSwarm() }));

    expect(screen.queryByRole('button', { name: /kept as you edited/ })).toBeNull();
  });

  it('singular, closed by default', () => {
    renderRow(swarmItem({ installed: installedSwarm() }), { kept: [builder] });

    const toggle = screen.getByRole('button', { name: '1 file kept as you edited it' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Take shipped prompt')).toBeNull();
  });

  it('plural, open lists each file and calls back with it', () => {
    const calls = renderRow(swarmItem({ installed: installedSwarm() }), { kept: [builder, tdd] });

    fireEvent.click(screen.getByRole('button', { name: '2 files kept as you edited them' }));

    expect(screen.getByText('builder')).toBeInTheDocument();
    expect(screen.getByText('/tdd')).toBeInTheDocument();
    const takes = screen.getAllByRole('button', { name: 'Take shipped prompt' });
    const keeps = screen.getAllByRole('button', { name: 'Keep mine' });
    fireEvent.click(takes[0] as HTMLElement);
    fireEvent.click(keeps[1] as HTMLElement);
    expect(calls.onTake).toHaveBeenCalledWith(builder);
    expect(calls.onKeep).toHaveBeenCalledWith(tdd);
  });
});

describe('SwarmRow notice', () => {
  it("shows the pane's sentence under the row in red", () => {
    render(
      <SwarmRow
        item={swarmItem({ installed: installedSwarm() })}
        source="cloud"
        busy={false}
        failure={undefined}
        kept={[]}
        notice="The swarm folder is in use."
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onAutoUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTake={vi.fn()}
        onKeep={vi.fn()}
        onTurnOn={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.getByText('The swarm folder is in use.')).toHaveClass('text-red');
  });
});

describe('SwarmRow: on, off and missing (HIVE-453)', () => {
  const squad = (over: Parameters<typeof installedSwarm>[0] = {}, missing = { agents: [] as string[], skills: ['plan'] }) =>
    swarmItem({
      entry: swarmEntry({ title: 'Dev Squad' }),
      installed: installedSwarm({
        title: 'Dev Squad',
        contents: {
          agents: ['shipper', 'builder', 'fixer', 'acr'].map((name) => ({ name, description: '', tools: [] })),
          skills: ['spec-deviation', 'plan', 'tdd'].map((name) => ({ name, description: '' })),
        },
        disabled: { agents: ['acr'], skills: ['spec-deviation'] },
        ...over,
      }),
      missing,
    });

  it('appends the on-counts to the counts line', () => {
    renderRow(squad());

    expect(screen.getByText(/4 agents · 3 skills · 3 of 4 agents and 2 of 3 skills on/)).toBeInTheDocument();
  });

  it('lists what is turned off with Turn on, and what is missing with Restore', () => {
    const calls = renderRow(squad());

    expect(screen.getByText('1 agent and 1 skill turned off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on acr' }));
    expect(calls.onTurnOn).toHaveBeenCalledWith('agents', 'acr');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on /spec-deviation' }));
    expect(calls.onTurnOn).toHaveBeenCalledWith('skills', 'spec-deviation');

    expect(screen.getByText('1 skill missing')).toBeInTheDocument();
    expect(screen.getByText("Deleted outside HiveTTY. Updates won't bring it back by themselves.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore /plan' }));
    expect(calls.onRestore).toHaveBeenCalledWith('skills', 'plan');
  });

  it('a bundled swarm says when a missing item can be restored, with no button', () => {
    renderRow(squad({ version: 'bundled' }));

    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
    expect(screen.getByText("Can be restored after Dev Squad's first update.")).toBeInTheDocument();
  });

  it('renders neither section when both lists are empty', () => {
    renderRow(squad({ disabled: { agents: [], skills: [] } }, { agents: [], skills: [] }));

    expect(screen.queryByText(/turned off$/)).toBeNull();
    expect(screen.queryByText(/missing$/)).toBeNull();
    expect(screen.getByText(/4 of 4 agents and 3 of 3 skills on/)).toBeInTheDocument();
  });

  it('a swarm not installed shows no on-counts and no sections', () => {
    renderRow(swarmItem({ entry: swarmEntry() }), { failure: FAILED });

    expect(screen.queryByText(/ on$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Turn on/ })).toBeNull();
  });

  it('Turn on and Restore wait while the row is busy', () => {
    renderRow(squad(), { busy: true });

    expect(screen.getByRole('button', { name: 'Turn on acr' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore /plan' })).toBeDisabled();
  });
});
