import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClis, type CliModel } from '@shared/cli-contract';
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

const cliTokensState = vi.fn();
const setCliToken = vi.fn();
const clearCliToken = vi.fn();

vi.mock('@lib/cli-tokens', () => ({
  cliTokensState: () => cliTokensState(),
  setCliToken: (request: unknown) => setCliToken(request),
  clearCliToken: (request: unknown) => clearCliToken(request),
}));

const codexModels = vi.fn<() => Promise<CliModel[] | null>>(() => Promise.resolve(null));
vi.mock('@lib/cli-models', () => ({ codexModels: () => codexModels() }));

/** The Claude Code card: since HIVE-342 there is a card per CLI. */
const claude = () => within(screen.getByRole('region', { name: 'Claude Code' }));
const codex = () => within(screen.getByRole('region', { name: 'Codex' }));
const copilot = () => within(screen.getByRole('region', { name: 'Copilot' }));

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
    cliTokensState.mockReset().mockResolvedValue({ copilot: false, encryptionAvailable: true });
    setCliToken.mockReset().mockResolvedValue({ copilot: true, encryptionAvailable: true });
    clearCliToken.mockReset().mockResolvedValue({ copilot: false, encryptionAvailable: true });
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

  it("lists the account's Codex models in Codex's model select", async () => {
    codexModels.mockResolvedValueOnce([
      { slug: 'gpt-6.1-sol', description: '', defaultEffort: 'low', efforts: ['low'] },
      { slug: 'gpt-7-nova', description: '', defaultEffort: 'low', efforts: ['low'] },
    ]);
    seed(undefined);
    render(<ClisSection />);
    const model = codex().getByRole('combobox', { name: 'Model' });
    await waitFor(() =>
      expect(within(model).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
        '',
        'gpt-6.1-sol',
        'gpt-7-nova',
      ]),
    );
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
      'Copilot',
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

describe('the Copilot card (HIVE-343)', () => {
  beforeEach(() => {
    setCliAgentsConfig.mockReset();
    cliTokensState.mockReset().mockResolvedValue({ copilot: false, encryptionAvailable: true });
    setCliToken.mockReset().mockResolvedValue({ copilot: true, encryptionAvailable: true });
    clearCliToken.mockReset().mockResolvedValue({ copilot: false, encryptionAvailable: true });
  });
  afterEach(() => resetProjectConfig());

  it('renders a card per CLI, Copilot third', () => {
    seed(undefined);
    render(<ClisSection />);

    expect(screen.getByRole('region', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Copilot' })).toBeInTheDocument();
  });

  it('has a token field with its hint, and stores what is typed on Enter', async () => {
    seed(undefined);
    render(<ClisSection />);

    const field = await copilot().findByLabelText('Token');

    expect(
      copilot().getByText(
        'A fine-grained PAT with Copilot Requests, or an OAuth token (gho_…). Stored encrypted; agents get it as COPILOT_GITHUB_TOKEN.',
      ),
    ).toBeInTheDocument();
    expect(field).toHaveAttribute('placeholder', 'gho_… or github_pat_…');

    await userEvent.type(field, 'gho_abc{Enter}');

    expect(setCliToken).toHaveBeenCalledWith({ cli: 'copilot', token: 'gho_abc' });
    expect(field).toHaveValue('');
    await waitFor(() => expect(field).toHaveAttribute('placeholder', 'Replace the stored token'));
  });

  it('commits nothing for an empty field', async () => {
    seed(undefined);
    render(<ClisSection />);

    await userEvent.type(await copilot().findByLabelText('Token'), '   {Enter}');

    expect(setCliToken).not.toHaveBeenCalled();
  });

  it('offers to replace and clear a stored token', async () => {
    cliTokensState.mockResolvedValue({ copilot: true, encryptionAvailable: true });
    seed(undefined);
    render(<ClisSection />);

    expect(await copilot().findByLabelText('Token')).toHaveAttribute(
      'placeholder',
      'Replace the stored token',
    );
    await userEvent.click(copilot().getByRole('button', { name: 'Clear token' }));

    expect(clearCliToken).toHaveBeenCalledWith({ cli: 'copilot' });
    await waitFor(() =>
      expect(copilot().queryByRole('button', { name: 'Clear token' })).not.toBeInTheDocument(),
    );
  });

  it('says so when there is no keyring, and shows no field', async () => {
    cliTokensState.mockResolvedValue({ copilot: false, encryptionAvailable: false });
    seed(undefined);
    render(<ClisSection />);

    expect(
      await copilot().findByText('This system has no keyring, so no token can be stored.'),
    ).toBeInTheDocument();
    expect(copilot().queryByLabelText('Token')).not.toBeInTheDocument();
  });

  it('shows no token field while the state is unknown', () => {
    cliTokensState.mockResolvedValue(null);
    seed(undefined);
    render(<ClisSection />);

    expect(copilot().queryByLabelText('Token')).not.toBeInTheDocument();
  });

  it('adds a deny pattern and writes it on blur', async () => {
    seed(undefined);
    render(<ClisSection />);

    expect(copilot().getByText('Each one becomes --deny-tool, and wins over every grant.')).toBeInTheDocument();
    await userEvent.click(copilot().getByRole('button', { name: 'Add pattern' }));
    await userEvent.type(copilot().getByLabelText('Deny pattern 1'), 'shell(rm:*)');
    await userEvent.tab();

    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'copilot', deny: ['shell(rm:*)'] });
  });

  it('removes a pattern, and an empty list writes null', async () => {
    seed({ copilot: { agents: { enabled: true, deny: ['shell(rm:*)'] } } });
    render(<ClisSection />);

    expect(copilot().getByLabelText('Deny pattern 1')).toHaveValue('shell(rm:*)');
    await userEvent.click(copilot().getByRole('button', { name: 'Remove deny pattern 1' }));

    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'copilot', deny: null });
    expect(copilot().queryByLabelText('Deny pattern 1')).not.toBeInTheDocument();
  });

  it('flags a row that is not a pattern and commits nothing', async () => {
    seed(undefined);
    render(<ClisSection />);

    await userEvent.click(copilot().getByRole('button', { name: 'Add pattern' }));
    await userEvent.type(copilot().getByLabelText('Deny pattern 1'), 'not valid');
    await userEvent.tab();

    expect(
      copilot().getByText('Use kind(argument), like shell(git push) or write(.env)'),
    ).toBeInTheDocument();
    expect(setCliAgentsConfig).not.toHaveBeenCalled();
  });

  it('puts neither the token nor the deny list on Claude Code or Codex', async () => {
    seed(undefined);
    render(<ClisSection />);

    await copilot().findByLabelText('Token');
    for (const card of [claude(), codex()]) {
      expect(card.queryByLabelText('Token')).not.toBeInTheDocument();
      expect(card.queryByRole('button', { name: 'Add pattern' })).not.toBeInTheDocument();
    }
  });
});
