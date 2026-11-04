import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HarnessPage } from '@features/settings/components/harness-page';
import { BUILT_IN_PICKS } from '@lib/harness/session-cli';
import { readCliSignIn } from '@lib/cli-sign-in';
import { CLI_NAMES } from '@lib/harness/cli-names';
import {
  CLI_INSTALL_HINTS,
  COPILOT_MODELS,
  resolveClis,
  type CliDetection,
  type CliModel,
  type ClisConfig,
} from '@shared/cli-contract';
import { emptySnapshot, type ConfigSnapshot } from '@shared/config-contract';
import type { HarnessId } from '@shared/harness-contract';

const setCliSessionsConfig = vi.fn();
const setRuntimeConfig = vi.fn(async (_request: unknown) => {});
const setCliConfig = vi.fn(async (_request: unknown) => {});
const diagnoseAgentCommand = vi.fn(async (_request: unknown) => null);
vi.mock('@/lib/project-config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setCliSessionsConfig: (request: unknown) => setCliSessionsConfig(request),
  setCliAgentsConfig: vi.fn(),
  setRuntimeConfig: (request: unknown) => setRuntimeConfig(request),
  setCliConfig: (request: unknown) => setCliConfig(request),
  diagnoseAgentCommand: (request: unknown) => diagnoseAgentCommand(request),
}));

let snapshot: ConfigSnapshot | null = null;
let server: string | null = null;
vi.mock('@hooks/use-project-config', () => ({
  useProjectConfig: () => snapshot,
  useAttachedServer: () => server,
}));

type Detection = Record<HarnessId, CliDetection>;
let detected: Detection | null = null;
const rescan = vi.fn(async () => {});
vi.mock('@hooks/use-cli-detection', () => ({
  useCliDetection: () => ({ detection: detected, settled: true, rescan, rescanning: false }),
}));

const SOL: CliModel = { slug: 'gpt-6.1-sol', description: '', defaultEffort: 'low', efforts: ['low', 'ultra'] };
const LUNA: CliModel = { slug: 'gpt-6-luna', description: '', defaultEffort: 'medium', efforts: ['low', 'medium'] };
vi.mock('@hooks/use-codex-models', () => ({ useCodexModels: () => ({ models: [SOL, LUNA], settled: true }) }));
const cliTokensState = vi.fn();
vi.mock('@lib/cli-tokens', () => ({
  cliTokensState: () => cliTokensState(),
  setCliToken: vi.fn(),
  clearCliToken: vi.fn(),
}));
vi.mock('@lib/cli-sign-in', () => ({ readCliSignIn: vi.fn() }));

const PATH = '/usr/local/bin/x';
const VERSIONS: Record<HarnessId, string> = { 'claude-code': '2.1.31', codex: '0.165.2', copilot: '1.0.4' };
const found: Detection = {
  'claude-code': { path: PATH, version: VERSIONS['claude-code'] },
  codex: { path: PATH, version: VERSIONS.codex },
  copilot: { path: PATH, version: VERSIONS.copilot },
};

function renderPage(cli: HarnessId, opts: { clis?: ClisConfig; detection?: Detection | null; server?: string } = {}) {
  snapshot = { ...emptySnapshot('/home/dev/.hive/config.json'), clis: opts.clis ?? resolveClis({}) };
  detected = opts.detection === undefined ? found : opts.detection;
  server = opts.server ?? null;
  return render(<HarnessPage cli={cli} />);
}

beforeEach(() => {
  setCliSessionsConfig.mockReset();
  setRuntimeConfig.mockClear();
  setCliConfig.mockClear();
  diagnoseAgentCommand.mockClear();
  rescan.mockClear();
  cliTokensState.mockReset().mockResolvedValue({ copilot: false, encryptionAvailable: true });
  vi.mocked(readCliSignIn).mockReset().mockResolvedValue({ state: 'in', label: 'Signed in as dev@example.com' });
});

describe('HarnessPage (HIVE-376)', () => {
  it.each(['claude-code', 'codex', 'copilot'] as const)('%s: name, version and path from detection', (cli) => {
    renderPage(cli);
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(CLI_NAMES[cli]) })).toBeInTheDocument();
    expect(screen.getByText(VERSIONS[cli])).toBeInTheDocument();
    expect(screen.getByText(PATH)).toBeInTheDocument();
  });

  it('a missing CLI shows its reason and install hint', () => {
    renderPage('copilot', { detection: { ...found, copilot: { missing: '`copilot` was not found on PATH.' } } });
    expect(screen.getByText('`copilot` was not found on PATH.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(CLI_INSTALL_HINTS.copilot)).toBeInTheDocument();
  });

  it('names the server it is attached to', () => {
    renderPage('codex', { server: 'mac-mini' });
    expect(screen.getByText(/On mac-mini/)).toBeInTheDocument();
  });

  it('the switch writes sessions, and is disabled when last on', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage('codex');
    await user.click(screen.getByRole('switch', { name: 'Use for sessions' }));
    expect(setCliSessionsConfig).toHaveBeenCalledWith({ sessions: { codex: false } });
    unmount();

    renderPage('claude-code', { clis: resolveClis({ codex: { sessions: false }, copilot: { sessions: false } }) });
    expect(screen.getByRole('switch', { name: 'Use for sessions' })).toBeDisabled();
  });

  it('sign-in: in, out with its fix, unknown', async () => {
    const { unmount } = renderPage('claude-code');
    expect(await screen.findByText('Signed in as dev@example.com')).toBeInTheDocument();
    expect(readCliSignIn).toHaveBeenCalledWith('claude-code');
    unmount();

    vi.mocked(readCliSignIn).mockResolvedValueOnce({ state: 'out', label: 'Not signed in', fix: 'codex login' });
    const second = renderPage('codex');
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
    expect(screen.getByText('codex login')).toBeInTheDocument();
    second.unmount();

    vi.mocked(readCliSignIn).mockResolvedValueOnce({ state: 'unknown', label: "Couldn't read the sign-in." });
    renderPage('copilot');
    expect(await screen.findByText("Couldn't read the sign-in.")).toBeInTheDocument();
    expect(screen.queryByText(/in a terminal/)).not.toBeInTheDocument();
  });

  it('Copilot shows the agent token field under sign-in', async () => {
    renderPage('copilot');
    const signIn = screen.getByRole('heading', { name: 'Sign-in' }).closest('section') ?? document.body;
    expect(await screen.findByLabelText('Token')).toBeInTheDocument();
    expect(signIn).toContainElement(screen.getByLabelText('Token'));
  });

  it('puts no token field on Claude Code or Codex', async () => {
    renderPage('codex');
    await screen.findByText('Signed in as dev@example.com');
    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
  });

  it('shows the headless agents group and what the CLI supports', () => {
    renderPage('codex');
    expect(screen.getByRole('heading', { name: 'Headless agents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What it supports' })).toBeInTheDocument();
  });

  it('with no snapshot, says it is only in the desktop app', () => {
    snapshot = null;
    detected = found;
    render(<HarnessPage cli="codex" />);
    expect(screen.getByRole('heading', { level: 2, name: /Codex/ })).toBeInTheDocument();
    expect(screen.getByText('CLI settings are only available in the desktop app.')).toBeInTheDocument();
  });
});

describe('HarnessPage: the command (HIVE-376)', () => {
  it('Claude: commits the global command through setRuntimeConfig, then rescans', async () => {
    const user = userEvent.setup();
    renderPage('claude-code');
    const field = screen.getByLabelText('Command');
    expect(field).toHaveValue('claude');
    await user.clear(field);
    await user.type(field, 'claude --x');
    await user.tab();
    expect(setRuntimeConfig).toHaveBeenCalledWith({ claudeCommand: 'claude --x' });
    await waitFor(() => expect(rescan).toHaveBeenCalled());
  });

  it('Claude: an empty commit restores the field and writes nothing', async () => {
    const user = userEvent.setup();
    renderPage('claude-code');
    const field = screen.getByLabelText('Command');
    await user.clear(field);
    await user.tab();
    expect(field).toHaveValue('claude');
    expect(setRuntimeConfig).not.toHaveBeenCalled();
  });

  it('Codex: commits clis.codex.command, and empty writes null; the placeholder is its bare name', async () => {
    const user = userEvent.setup();
    renderPage('codex');
    const field = screen.getByLabelText('Command');
    expect(field).toHaveAttribute('placeholder', 'codex');
    await user.type(field, 'codex-x');
    await user.tab();
    expect(setCliConfig).toHaveBeenCalledWith({ cli: 'codex', command: 'codex-x' });
    await waitFor(() => expect(rescan).toHaveBeenCalled());
  });

  it('Codex: clearing a saved command writes null', async () => {
    const user = userEvent.setup();
    renderPage('codex', { clis: resolveClis({ codex: { command: 'codex-x' } }) });
    const field = screen.getByLabelText('Command');
    expect(field).toHaveValue('codex-x');
    await user.clear(field);
    await user.tab();
    expect(setCliConfig).toHaveBeenCalledWith({ cli: 'codex', command: null });
  });

  it.each(['codex --flag', 'FOO=1 codex', '~/bin/codex'])('hints that agent runs need a plain command for %s', async (typed) => {
    const user = userEvent.setup();
    renderPage('codex');
    expect(screen.queryByText(/agent runs need a plain command/)).toBeNull();
    await user.type(screen.getByLabelText('Command'), typed);
    expect(screen.getByText('Sessions accept this; agent runs need a plain command.')).toBeInTheDocument();
  });

  it('shows no such hint for a plain command, and still saves one that has it', async () => {
    const user = userEvent.setup();
    renderPage('codex');
    await user.type(screen.getByLabelText('Command'), '/opt/codex');
    expect(screen.queryByText(/agent runs need a plain command/)).toBeNull();
    await user.clear(screen.getByLabelText('Command'));
    await user.type(screen.getByLabelText('Command'), 'codex --x');
    await user.tab();
    expect(setCliConfig).toHaveBeenCalledWith({ cli: 'codex', command: 'codex --x' });
  });

  it.each(['claude-code', 'codex', 'copilot'] as const)('%s: diagnoses its own command on mount', async (cli) => {
    renderPage(cli);
    await waitFor(() => expect(diagnoseAgentCommand).toHaveBeenCalledWith({ cli }));
  });

  it('re-diagnoses once the snapshot reflects a commit', async () => {
    const view = renderPage('copilot');
    await waitFor(() => expect(diagnoseAgentCommand).toHaveBeenCalledTimes(1));
    snapshot = { ...snapshot!, clis: resolveClis({ copilot: { command: '/opt/copilot' } }) };
    view.rerender(<HarnessPage cli="copilot" />);
    await waitFor(() => expect(diagnoseAgentCommand).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Command')).toHaveValue('/opt/copilot');
  });
});

describe('HarnessPage: new sessions (HIVE-376)', () => {
  const group = () => within(screen.getByRole('heading', { name: 'New sessions' }).closest('section')!);

  it('Claude: stepping the model writes sessionModel', async () => {
    const user = userEvent.setup();
    renderPage('claude-code');
    await user.click(group().getByRole('radio', { name: /haiku/ }));
    expect(setCliConfig).toHaveBeenCalledWith({ cli: 'claude-code', sessionModel: 'haiku' });
  });

  it('Copilot: selecting a model writes sessionModel', async () => {
    const user = userEvent.setup();
    renderPage('copilot');
    await user.selectOptions(group().getByRole('combobox', { name: 'Model' }), COPILOT_MODELS[1]);
    expect(setCliConfig).toHaveBeenCalledWith({ cli: 'copilot', sessionModel: COPILOT_MODELS[1] });
  });

  it('stepping the effort writes sessionEffort', async () => {
    const user = userEvent.setup();
    renderPage('claude-code');
    await user.click(within(group().getByRole('radiogroup', { name: /effort/ })).getByRole('radio', { name: /^max/ }));
    expect(setCliConfig).toHaveBeenCalledWith({ cli: 'claude-code', sessionEffort: 'max' });
  });

  it("Codex: a model that lacks the saved effort clears it in the same write", async () => {
    const user = userEvent.setup();
    renderPage('codex', { clis: resolveClis({ codex: { sessionModel: SOL.slug, sessionEffort: 'ultra' } }) });
    await user.click(group().getByRole('radio', { name: /luna/ }));
    expect(setCliConfig).toHaveBeenCalledWith({ cli: 'codex', sessionModel: LUNA.slug, sessionEffort: null });
  });

  it('shows the built-in pick with nothing configured, and the configured one when set', () => {
    const first = renderPage('claude-code');
    expect(group().getByRole('radio', { name: new RegExp(BUILT_IN_PICKS['claude-code'].model) })).toBeChecked();
    first.unmount();

    renderPage('copilot', { clis: resolveClis({ copilot: { sessionModel: COPILOT_MODELS[2] } }) });
    expect(group().getByRole('combobox', { name: 'Model' })).toHaveValue(COPILOT_MODELS[2]);
  });
});
