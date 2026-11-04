import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClis, type CliDetection, type ClisConfig } from '@shared/cli-contract';
import { emptySnapshot, type ConfigSnapshot } from '@shared/config-contract';
import type { HarnessId } from '@shared/harness-contract';

import { HarnessesOverviewSection } from '@features/settings/components/harnesses-overview-section';

const setCliSessionsConfig = vi.fn();
vi.mock('@/lib/project-config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setCliSessionsConfig: (request: unknown) => setCliSessionsConfig(request),
  setCliAgentsConfig: vi.fn(),
  setAgentsDefaultCliConfig: vi.fn(),
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
let rescanning = false;
vi.mock('@hooks/use-cli-detection', () => ({
  useCliDetection: () => ({ detection: detected, settled: true, rescan, rescanning }),
}));

vi.mock('@hooks/use-codex-models', () => ({ useCodexModels: () => ({ models: [], settled: true }) }));
vi.mock('@lib/cli-tokens', () => ({
  cliTokensState: () => Promise.resolve(null),
  setCliToken: vi.fn(),
  clearCliToken: vi.fn(),
}));

const detection: Detection = {
  'claude-code': { path: '/Users/me/.local/bin/claude', version: '2.1.31' },
  codex: { path: '/opt/homebrew/bin/codex', version: '0.165.2' },
  copilot: { missing: '`copilot` was not found on PATH.' },
};

function renderWith(opts: {
  detection: Detection | null;
  clis: ClisConfig;
  sessionsDefaultCli?: HarnessId;
  server?: string;
  rescanning?: boolean;
}) {
  snapshot = {
    ...emptySnapshot('/home/dev/.hive/config.json'),
    clis: opts.clis,
    ...(opts.sessionsDefaultCli === undefined ? {} : { sessionsDefaultCli: opts.sessionsDefaultCli }),
  };
  server = opts.server ?? null;
  detected = opts.detection;
  rescanning = opts.rescanning ?? false;
  return render(<HarnessesOverviewSection />);
}

describe('HarnessesOverviewSection (HIVE-375)', () => {
  beforeEach(() => {
    setCliSessionsConfig.mockReset();
    rescan.mockClear();
  });

  it('lists each CLI: path and version, or the reason and its install hint', () => {
    renderWith({ detection, clis: resolveClis({}) });
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('/opt/homebrew/bin/codex')).toBeInTheDocument();
    expect(screen.getByText('0.165.2')).toBeInTheDocument();
    expect(screen.getByText('`copilot` was not found on PATH.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('npm i -g @github/copilot')).toBeInTheDocument();
    expect(screen.getByText(/found on this Mac/)).toBeInTheDocument();
  });

  it('writes the switch and the radio, and disables the last switch still on', async () => {
    const user = userEvent.setup();
    renderWith({ detection, clis: resolveClis({ codex: { sessions: false }, copilot: { sessions: false } }) });
    expect(screen.getByRole('switch', { name: 'Use Claude Code for sessions' })).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Use Codex for sessions' }));
    expect(setCliSessionsConfig).toHaveBeenCalledWith({ sessions: { codex: true } });
    await user.click(screen.getByRole('radio', { name: 'Codex is the default for new sessions' }));
    expect(setCliSessionsConfig).toHaveBeenCalledWith({ defaultCli: 'codex' });
    expect(screen.getByRole('radio', { name: 'Claude Code is the default for new sessions' })).toBeChecked();
  });

  it('turns a CLI off', async () => {
    const user = userEvent.setup();
    renderWith({ detection, clis: resolveClis({}) });
    await user.click(screen.getByRole('switch', { name: 'Use Codex for sessions' }));
    expect(setCliSessionsConfig).toHaveBeenCalledWith({ sessions: { codex: false } });
  });

  it('warns when the default cannot start, naming where sessions start instead', () => {
    renderWith({ detection, clis: resolveClis({}), sessionsDefaultCli: 'copilot' });
    expect(screen.getByText('New sessions start on Claude Code instead')).toBeInTheDocument();
  });

  it('shows no warning when the default can start, nor before anything was detected', () => {
    renderWith({ detection: null, clis: resolveClis({}), sessionsDefaultCli: 'copilot' });
    expect(screen.queryByText(/New sessions start on/)).not.toBeInTheDocument();
  });

  it('names the server it is attached to, and rescans', async () => {
    const user = userEvent.setup();
    renderWith({ detection, clis: resolveClis({}), server: 'mac-mini' });
    expect(screen.getByText(/found on mac-mini/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rescan' }));
    expect(rescan).toHaveBeenCalled();
  });

  it('says it is busy while a rescan is in flight', () => {
    renderWith({ detection, clis: resolveClis({}), rescanning: true });
    expect(screen.getByRole('button', { name: 'Rescan' })).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps the headless agent settings below (D7)', () => {
    renderWith({ detection, clis: resolveClis({}) });
    expect(screen.getByRole('heading', { name: 'Headless agents', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Default CLI for agents')).toBeInTheDocument();
  });

  it('says it is desktop-only with no config (the browser target)', () => {
    snapshot = null;
    render(<HarnessesOverviewSection />);
    expect(screen.getByText(/only available in the desktop app/)).toBeInTheDocument();
  });
});
