import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HarnessPage } from '@features/settings/components/harness-page';
import { readCliSignIn } from '@lib/cli-sign-in';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { CLI_INSTALL_HINTS, resolveClis, type CliDetection, type ClisConfig } from '@shared/cli-contract';
import { emptySnapshot, type ConfigSnapshot } from '@shared/config-contract';
import type { HarnessId } from '@shared/harness-contract';

const setCliSessionsConfig = vi.fn();
vi.mock('@/lib/project-config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setCliSessionsConfig: (request: unknown) => setCliSessionsConfig(request),
  setCliAgentsConfig: vi.fn(),
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

vi.mock('@hooks/use-codex-models', () => ({ useCodexModels: () => ({ models: [], settled: true }) }));
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
