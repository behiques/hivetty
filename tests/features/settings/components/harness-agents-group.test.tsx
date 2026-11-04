import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CopilotToken, HarnessAgentsGroup } from '@features/settings/components/harness-agents-group';
import { resolveClis, type CliModel } from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';

const setCliAgentsConfig = vi.fn();

vi.mock('@/lib/project-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-config')>();
  return { ...actual, setCliAgentsConfig: (request: unknown) => setCliAgentsConfig(request) };
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
vi.mock('@lib/cli-models', () => ({ codexModels: () => codexModels(), lastCodexModels: () => undefined }));

/** One CLI's agents group, its defaults seeded from `agents` as the config would resolve them. */
const renderGroup = (cli: HarnessId, agents?: Parameters<typeof resolveClis>[0]) =>
  render(<HarnessAgentsGroup cli={cli} agents={resolveClis(agents)[cli].agents} />);

beforeEach(() => {
  setCliAgentsConfig.mockReset();
  codexModels.mockReset().mockResolvedValue(null);
  cliTokensState.mockReset().mockResolvedValue({ copilot: false, encryptionAvailable: true });
  setCliToken.mockReset().mockResolvedValue({ copilot: true, encryptionAvailable: true });
  clearCliToken.mockReset().mockResolvedValue({ copilot: false, encryptionAvailable: true });
});

describe('HarnessAgentsGroup (HIVE-376, from HIVE-341/342)', () => {
  it('renders the Headless agents group, on and on CLI default', () => {
    renderGroup('claude-code');

    expect(screen.getByRole('heading', { name: 'Headless agents' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enabled for agents' })).toBeChecked();
    expect(screen.getByLabelText('Model')).toHaveValue('');
    expect(screen.getByLabelText('Model')).toBeEnabled();
  });

  it('turning it off writes enabled: false', async () => {
    renderGroup('claude-code');

    await userEvent.click(screen.getByRole('switch', { name: 'Enabled for agents' }));

    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', enabled: false });
  });

  it('a model writes the model, and CLI default writes null', async () => {
    renderGroup('claude-code', { 'claude-code': { agents: { effort: 'high' } } });

    await userEvent.selectOptions(screen.getByLabelText('Model'), 'haiku');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', model: 'haiku' });

    await userEvent.selectOptions(screen.getByLabelText('Effort'), '');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', effort: null });

    await userEvent.selectOptions(screen.getByLabelText('Effort'), 'max');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', effort: 'max' });

    await userEvent.selectOptions(screen.getByLabelText('Model'), '');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', model: null });
  });

  it('off: dims and disables the defaults, and says what that means', () => {
    renderGroup('claude-code', { 'claude-code': { agents: { enabled: false } } });

    expect(screen.getByLabelText('Model')).toBeDisabled();
    expect(screen.getByLabelText('Effort')).toBeDisabled();
    expect(screen.getByText(/agents skip Claude Code/)).toBeInTheDocument();
  });

  it("lists the account's Codex models in Codex's model select", async () => {
    codexModels.mockResolvedValueOnce([
      { slug: 'gpt-6.1-sol', description: '', defaultEffort: 'low', efforts: ['low'] },
      { slug: 'gpt-7-nova', description: '', defaultEffort: 'low', efforts: ['low'] },
    ]);
    renderGroup('codex');
    const model = screen.getByRole('combobox', { name: 'Model' });
    await waitFor(() =>
      expect(within(model).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
        '',
        'gpt-6.1-sol',
        'gpt-7-nova',
      ]),
    );
  });

  it('keeps a saved Codex model the account lacks in the select, rather than showing it blank', async () => {
    codexModels.mockResolvedValueOnce([{ slug: 'gpt-6.1-sol', description: '', defaultEffort: 'low', efforts: ['low'] }]);
    renderGroup('codex', { codex: { agents: { model: 'gpt-5.6-luna' } } });
    const model = screen.getByRole('combobox', { name: 'Model' });
    await waitFor(() =>
      expect(within(model).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
        '',
        'gpt-6.1-sol',
        'gpt-5.6-luna',
      ]),
    );
    expect(model).toHaveValue('gpt-5.6-luna');
  });

  it("offers only the saved Codex model's own efforts", async () => {
    codexModels.mockResolvedValueOnce([
      { slug: 'gpt-6-luna', description: '', defaultEffort: 'medium', efforts: ['low', 'medium', 'max'] },
    ]);
    renderGroup('codex', { codex: { agents: { model: 'gpt-6-luna' } } });
    const effort = screen.getByRole('combobox', { name: 'Effort' });
    await waitFor(() =>
      expect(within(effort).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
        '',
        'low',
        'medium',
        'max',
      ]),
    );
  });

  it('clears a saved Codex effort the newly chosen model lacks, in the same write', async () => {
    const user = userEvent.setup();
    codexModels.mockResolvedValueOnce([
      { slug: 'gpt-6.1-sol', description: '', defaultEffort: 'low', efforts: ['low', 'ultra'] },
      { slug: 'gpt-6-luna', description: '', defaultEffort: 'medium', efforts: ['low', 'medium'] },
    ]);
    renderGroup('codex', { codex: { agents: { model: 'gpt-6.1-sol', effort: 'ultra' } } });
    const model = screen.getByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(within(model).getAllByRole('option')).toHaveLength(3));

    await user.selectOptions(model, 'gpt-6-luna');
    expect(setCliAgentsConfig).toHaveBeenLastCalledWith({ cli: 'codex', model: 'gpt-6-luna', effort: null });

    await user.selectOptions(model, 'gpt-6.1-sol');
    expect(setCliAgentsConfig).toHaveBeenLastCalledWith({ cli: 'codex', model: 'gpt-6.1-sol' });
  });

  it("reads CLI default as Codex's own first model: its efforts, and a saved effort it lacks cleared", async () => {
    const user = userEvent.setup();
    codexModels.mockResolvedValueOnce([
      { slug: 'gpt-6-luna', description: '', defaultEffort: 'medium', efforts: ['low', 'medium'] },
      { slug: 'gpt-6.1-sol', description: '', defaultEffort: 'low', efforts: ['low', 'ultra'] },
    ]);
    renderGroup('codex', { codex: { agents: { model: 'gpt-6.1-sol', effort: 'ultra' } } });
    const model = screen.getByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(within(model).getAllByRole('option')).toHaveLength(3));

    await user.selectOptions(model, '');
    expect(setCliAgentsConfig).toHaveBeenLastCalledWith({ cli: 'codex', model: null, effort: null });
  });

  it("holds Codex's fields until the account's list answers, so a pick is never judged against the fallback", async () => {
    let answer!: (models: CliModel[] | null) => void;
    codexModels.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    renderGroup('codex');
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();

    answer(null);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled());
  });

  it("never reads Codex's list on Claude Code", () => {
    renderGroup('claude-code');
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled();
    expect(codexModels).not.toHaveBeenCalled();
  });

  it('offers a sandbox on Codex only, workspace-write when unset, and writes a choice', async () => {
    const { unmount } = renderGroup('codex');

    const sandbox = screen.getByLabelText('Sandbox');
    expect(sandbox).toHaveValue('workspace-write');
    expect([...sandbox.querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual([
      'workspace-write',
      'read-only',
    ]);
    await userEvent.selectOptions(sandbox, 'read-only');
    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'codex', sandbox: 'read-only' });

    unmount();
    renderGroup('claude-code');
    expect(screen.queryByLabelText('Sandbox')).toBeNull();
    expect(screen.queryByText(/sandbox defaults to workspace-write/)).toBeNull();
    expect(screen.getByText(/in AGENT.md wins/)).toBeInTheDocument();
  });

  it('reads the codex model, effort and sandbox in that order, inert when off', () => {
    const { container } = renderGroup('codex', { codex: { agents: { enabled: false, sandbox: 'read-only' } } });

    const labels = [...container.querySelectorAll('fieldset label')].map((label) => label.textContent);
    expect(labels).toEqual(['Model', 'Effort', 'Sandbox']);
    expect(screen.getByLabelText('Sandbox')).toHaveValue('read-only');
    expect(screen.getByLabelText('Sandbox')).toBeDisabled();
    expect(screen.getByText(/sandbox defaults to workspace-write/)).toBeInTheDocument();
    expect(screen.getByText(/model: and effort: are Claude's/)).toBeInTheDocument();
  });
});

describe('Copilot deny patterns, inside its agents group (HIVE-376, from HIVE-343)', () => {
  it('adds a deny pattern and writes it on blur', async () => {
    renderGroup('copilot');

    expect(screen.getByText('Each one becomes --deny-tool, and wins over every grant.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add pattern' }));
    await userEvent.type(screen.getByLabelText('Deny pattern 1'), 'shell(rm:*)');
    await userEvent.tab();

    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'copilot', deny: ['shell(rm:*)'] });
  });

  it('removes a pattern, and an empty list writes null', async () => {
    renderGroup('copilot', { copilot: { agents: { enabled: true, deny: ['shell(rm:*)'] } } });

    expect(screen.getByLabelText('Deny pattern 1')).toHaveValue('shell(rm:*)');
    await userEvent.click(screen.getByRole('button', { name: 'Remove deny pattern 1' }));

    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'copilot', deny: null });
    expect(screen.queryByLabelText('Deny pattern 1')).not.toBeInTheDocument();
  });

  it('flags a row that is not a pattern and commits nothing', async () => {
    renderGroup('copilot');

    await userEvent.click(screen.getByRole('button', { name: 'Add pattern' }));
    await userEvent.type(screen.getByLabelText('Deny pattern 1'), 'not valid');
    await userEvent.tab();

    expect(screen.getByText('Use kind(argument), like shell(git push) or write(.env)')).toBeInTheDocument();
    expect(setCliAgentsConfig).not.toHaveBeenCalled();
  });

  it('puts no deny list on Claude Code or Codex', () => {
    for (const cli of ['claude-code', 'codex'] as const) {
      const { unmount } = renderGroup(cli);
      expect(screen.queryByRole('button', { name: 'Add pattern' })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('CopilotToken (HIVE-376, from HIVE-343)', () => {
  it('has a token field with its hint, and stores what is typed on Enter', async () => {
    render(<CopilotToken />);

    const field = await screen.findByLabelText('Token');

    expect(
      screen.getByText(
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
    render(<CopilotToken />);

    await userEvent.type(await screen.findByLabelText('Token'), '   {Enter}');

    expect(setCliToken).not.toHaveBeenCalled();
  });

  it('offers to replace and clear a stored token', async () => {
    cliTokensState.mockResolvedValue({ copilot: true, encryptionAvailable: true });
    render(<CopilotToken />);

    expect(await screen.findByLabelText('Token')).toHaveAttribute('placeholder', 'Replace the stored token');
    await userEvent.click(screen.getByRole('button', { name: 'Clear token' }));

    expect(clearCliToken).toHaveBeenCalledWith({ cli: 'copilot' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear token' })).not.toBeInTheDocument());
  });

  it('says so when there is no keyring, and shows no field', async () => {
    cliTokensState.mockResolvedValue({ copilot: false, encryptionAvailable: false });
    render(<CopilotToken />);

    expect(await screen.findByText('This system has no keyring, so no token can be stored.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
  });

  it('shows no token field while the state is unknown', () => {
    cliTokensState.mockResolvedValue(null);
    render(<CopilotToken />);

    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
  });
});
