import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SwarmConsent } from '@/features/settings/components/swarm-consent';

import type { InstalledSwarm, SwarmEntry } from '@shared/swarm-contract';

import { installedSwarm, swarmEntry } from '../../../support/swarms';

const SENTENCE = 'Agents in this swarm run on your machine with the tools listed here.';

const ENTRY = swarmEntry({
  version: '1.4.0',
  agents: [
    { name: 'builder', description: 'Builds plans.', tools: ['Read', 'Edit', 'Bash'] },
    { name: 'reviewer', description: 'Reviews diffs.', tools: ['Read', 'Grep'] },
  ],
  skills: [
    { name: 'tdd', description: 'Test first.' },
    { name: 'debug', description: 'Root cause first.' },
  ],
});

function renderConsent(entry: SwarmEntry, installed: InstalledSwarm | null = null, target: string | null = null) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<SwarmConsent entry={entry} installed={installed} target={target} onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel, dialog: screen.getByRole('dialog') };
}

describe('SwarmConsent, install mode', () => {
  it("lists every agent with its tools and every skill, under counted headings", () => {
    const { dialog } = renderConsent(ENTRY);

    expect(within(dialog).getByRole('heading', { name: 'Install Standard' })).toBeInTheDocument();
    expect(within(dialog).getByText('Native')).toBeInTheDocument();
    expect(within(dialog).getByText('v1.4.0')).toBeInTheDocument();
    expect(within(dialog).getByText('https://github.com/behiques/swarms.git')).toBeInTheDocument();
    expect(within(dialog).getByText('2 agents')).toBeInTheDocument();
    expect(within(dialog).getByText('2 skills')).toBeInTheDocument();
    expect(within(dialog).getByText('builder')).toBeInTheDocument();
    expect(within(dialog).getByText('Builds plans.')).toBeInTheDocument();
    for (const tool of ['Read', 'Edit', 'Bash', 'Grep']) expect(within(dialog).getAllByText(tool).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('/tdd')).toBeInTheDocument();
    expect(within(dialog).getByText('Root cause first.')).toBeInTheDocument();
    expect(within(dialog).getByText(SENTENCE)).toBeInTheDocument();
    expect(within(dialog).queryByText('What changes')).toBeNull();
  });

  it('sets agent and skill names in sans, not mono (DESIGN-SYSTEM: mono is for code)', () => {
    const { dialog } = renderConsent(ENTRY);

    expect(within(dialog).getByText('builder')).not.toHaveClass('font-mono');
    expect(within(dialog).getByText('builder')).toHaveClass('font-medium');
    expect(within(dialog).getByText('/tdd')).not.toHaveClass('font-mono');
    expect(within(dialog).getByText('/tdd')).toHaveClass('font-medium');
  });

  it('singular headings for one agent and one skill', () => {
    const { dialog } = renderConsent(swarmEntry());

    expect(within(dialog).getByText('1 agent')).toBeInTheDocument();
    expect(within(dialog).getByText('1 skill')).toBeInTheDocument();
  });

  it('names the pinned version for a pinned organization swarm, the one that installs', () => {
    const { dialog } = renderConsent(
      swarmEntry({ kind: 'organization', org: { id: 'o', name: 'Acme' }, version: '1.4.0', policy: 'pinned', pinnedVersion: '1.2.0' }),
    );

    expect(within(dialog).getByText('v1.2.0')).toBeInTheDocument();
    expect(within(dialog).queryByText('v1.4.0')).toBeNull();
  });

  it('leaves the version out when the row has none', () => {
    const { dialog } = renderConsent(swarmEntry({ kind: 'organization', org: { id: 'o', name: 'Acme' }, version: null }));

    expect(within(dialog).getByText('Acme')).toBeInTheDocument();
    expect(within(dialog).queryByText(/^v\d/)).toBeNull();
  });

  it('Install calls onConfirm once', () => {
    const { onConfirm, onCancel } = renderConsent(ENTRY);

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Cancel, the close control and Escape call onCancel', () => {
    const { onCancel, dialog } = renderConsent(ENTRY);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('never shows a model or autonomy', () => {
    const { dialog } = renderConsent(ENTRY);

    expect(dialog.textContent).not.toMatch(/model/i);
    expect(dialog.textContent).not.toMatch(/autonomy/i);
  });
});

describe('SwarmConsent, update mode', () => {
  const installed = installedSwarm({
    kind: 'community',
    version: '2.1.0',
    contents: {
      agents: [
        { name: 'builder', description: '', tools: ['Read', 'Edit'] },
        { name: 'old', description: '', tools: ['Read'] },
      ],
      skills: [
        { name: 'tdd', description: '' },
        { name: 'gone', description: '' },
      ],
    },
  });
  const entry = swarmEntry({
    kind: 'community',
    title: 'Kit',
    version: '2.2.0',
    agents: [
      { name: 'builder', description: 'Builds.', tools: ['Read', 'Bash'] },
      { name: 'fresh', description: 'New one.', tools: ['WebFetch'] },
    ],
    skills: [
      { name: 'tdd', description: 'Test first.' },
      { name: 'added', description: 'Added skill.' },
    ],
  });

  it('shows the version arrow and every diff line before the full list', () => {
    const { dialog } = renderConsent(entry, installed, '2.2.0');

    expect(within(dialog).getByRole('heading', { name: 'Update Kit' })).toBeInTheDocument();
    expect(within(dialog).getByText('Community')).toBeInTheDocument();
    expect(within(dialog).getByText('v2.1.0 → v2.2.0')).toBeInTheDocument();

    const changes = within(dialog).getByRole('region', { name: 'What changes' });
    expect(within(changes).getByText('New agent')).toBeInTheDocument();
    expect(within(changes).getByText('fresh')).toBeInTheDocument();
    expect(within(changes).getByText('WebFetch')).toBeInTheDocument();
    expect(within(changes).getByText('+Bash')).toBeInTheDocument();
    const removedTool = within(changes).getByText('Edit');
    expect(removedTool.tagName).toBe('DEL');
    expect(within(changes).getByText('Removed agent')).toBeInTheDocument();
    expect(within(changes).getByText('old')).toBeInTheDocument();
    expect(within(changes).getByText('/added')).toBeInTheDocument();
    expect(within(changes).getByText('/gone')).toBeInTheDocument();

    const whole = dialog.textContent ?? '';
    expect(whole.indexOf('What changes')).toBeLessThan(whole.indexOf('2 agents'));

    for (const name of ['fresh', 'old', '/added', '/gone']) {
      expect(within(changes).getByText(name)).not.toHaveClass('font-mono');
    }
  });

  it('says nothing changes for identical contents', () => {
    const same = installedSwarm({ contents: { agents: ENTRY.agents, skills: ENTRY.skills } });
    const { dialog } = renderConsent(ENTRY, same, '1.5.0');

    expect(within(dialog).getByText('No agents, skills or tools change.')).toBeInTheDocument();
  });

  it('Update calls onConfirm', () => {
    const { onConfirm } = renderConsent(entry, installed, '2.2.0');

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('labels a bundled installed version "Bundled" in the arrow', () => {
    const { dialog } = renderConsent(entry, installedSwarm({ ...installed, version: 'bundled' }), '1.0.1');

    expect(within(dialog).getByText('Bundled → v1.0.1')).toBeInTheDocument();
  });

  it('falls back to the row version when no target is given', () => {
    const { dialog } = renderConsent(entry, installed, null);

    expect(within(dialog).getByText('v2.1.0 → v2.2.0')).toBeInTheDocument();
  });
});
