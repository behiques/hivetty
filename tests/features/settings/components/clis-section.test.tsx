import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClis } from '@shared/cli-contract';
import { emptySnapshot, type ConfigSnapshot } from '@shared/config-contract';

import { ClisSection } from '@features/settings/components/clis-section';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';

const setCliAgentsConfig = vi.fn();
const setAgentsDefaultCliConfig = vi.fn();

vi.mock('@/lib/project-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-config')>();
  return {
    ...actual,
    setCliAgentsConfig: (request: unknown) => setCliAgentsConfig(request),
    setAgentsDefaultCliConfig: (request: unknown) => setAgentsDefaultCliConfig(request),
  };
});

/** The Claude Code card: since HIVE-342 there is a card per CLI. */
const claude = () => within(screen.getByRole('region', { name: 'Claude Code' }));
const codex = () => within(screen.getByRole('region', { name: 'Codex' }));

const seed = (agents: Parameters<typeof resolveClis>[0], over: Partial<ConfigSnapshot> = {}) =>
  setProjectConfigForTest({
    ...emptySnapshot('/home/dev/.hive/config.json'),
    clis: resolveClis(agents),
    ...over,
  });

describe('ClisSection (HIVE-341)', () => {
  beforeEach(() => {
    setCliAgentsConfig.mockReset();
    setAgentsDefaultCliConfig.mockReset();
  });
  afterEach(() => resetProjectConfig());

  it('renders a Headless agents group per CLI', () => {
    seed(undefined);
    render(<ClisSection />);

    expect(screen.getByRole('region', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Codex' })).toBeInTheDocument();
    expect(claude().getByRole('heading', { name: 'Headless agents' })).toBeInTheDocument();
    expect(claude().getByRole('switch', { name: 'Enabled for agents' })).toBeChecked();
    expect(claude().getByLabelText('Model')).toHaveValue('');
    expect(claude().getByLabelText('Model')).toBeEnabled();
  });

  it('turning it off writes enabled: false', async () => {
    seed(undefined);
    render(<ClisSection />);

    await userEvent.click(claude().getByRole('switch', { name: 'Enabled for agents' }));

    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', enabled: false });
  });

  it('a model writes the model, and CLI default writes null', async () => {
    seed({ 'claude-code': { agents: { effort: 'high' } } });
    render(<ClisSection />);

    await userEvent.selectOptions(claude().getByLabelText('Model'), 'haiku');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', model: 'haiku' });

    await userEvent.selectOptions(claude().getByLabelText('Effort'), '');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', effort: null });

    await userEvent.selectOptions(claude().getByLabelText('Effort'), 'max');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', effort: 'max' });

    await userEvent.selectOptions(claude().getByLabelText('Model'), '');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', model: null });
  });

  it('off: dims and disables the defaults, and says what that means', () => {
    seed({ 'claude-code': { agents: { enabled: false } } });
    render(<ClisSection />);

    expect(claude().getByLabelText('Model')).toBeDisabled();
    expect(claude().getByLabelText('Effort')).toBeDisabled();
    expect(screen.getByText(/agents skip Claude Code/)).toBeInTheDocument();
  });

  it('renders a card per CLI (HIVE-342)', () => {
    seed(undefined);
    render(<ClisSection />);

    expect(screen.getByRole('region', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Codex' })).toBeInTheDocument();
  });

  it('shows the default CLI for agents, claude-code when unset, and writes a choice (HIVE-342)', async () => {
    seed(undefined);
    render(<ClisSection />);

    const select = screen.getByLabelText('Default CLI for agents');
    expect(select).toHaveValue('claude-code');
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Claude Code',
      'Codex',
    ]);

    await userEvent.selectOptions(select, 'codex');
    expect(setAgentsDefaultCliConfig).toHaveBeenCalledWith({ cli: 'codex' });
  });

  it('shows the default CLI the snapshot names (HIVE-342)', () => {
    seed(undefined, { agentsDefaultCli: 'codex' });
    render(<ClisSection />);

    expect(screen.getByLabelText('Default CLI for agents')).toHaveValue('codex');
  });

  it("offers a sandbox on the codex card only, workspace-write when unset (HIVE-342)", async () => {
    seed(undefined);
    render(<ClisSection />);

    const sandbox = codex().getByLabelText('Sandbox');
    expect(sandbox).toHaveValue('workspace-write');
    expect([...sandbox.querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual([
      'workspace-write',
      'read-only',
    ]);
    expect(claude().queryByLabelText('Sandbox')).toBeNull();

    await userEvent.selectOptions(sandbox, 'read-only');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'codex', sandbox: 'read-only' });
  });

  it('reads the codex model, effort and sandbox in that order, inert when the card is off (HIVE-342)', () => {
    seed({ codex: { agents: { enabled: false, sandbox: 'read-only' } } });
    render(<ClisSection />);

    const card = screen.getByRole('region', { name: 'Codex' });
    const labels = [...card.querySelectorAll('fieldset label')].map((label) => label.textContent);
    expect(labels).toEqual(['Model', 'Effort', 'Sandbox']);
    expect(codex().getByLabelText('Sandbox')).toHaveValue('read-only');
    expect(codex().getByLabelText('Sandbox')).toBeDisabled();
    expect(codex().getByText(/sandbox defaults to workspace-write/)).toBeInTheDocument();
    // AGENT.md's model: and effort: are Claude's words (HIVE-340), so only Claude's card defers to them.
    expect(codex().getByText(/model: and effort: are Claude's/)).toBeInTheDocument();
    expect(claude().getByText(/in AGENT.md wins/)).toBeInTheDocument();
    expect(claude().queryByText(/sandbox defaults to workspace-write/)).toBeNull();
  });

  it('says it needs the desktop app before the config has loaded', () => {
    resetProjectConfig();
    render(<ClisSection />);

    expect(screen.getByText('CLI settings are only available in the desktop app.')).toBeInTheDocument();
  });
});
