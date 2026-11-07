import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexPluginGroup } from '@features/settings/components/codex-plugin-group';
import { resolveClis, type CodexPluginStatus } from '@shared/cli-contract';
import { emptySnapshot, type ConfigSnapshot } from '@shared/config-contract';

let status: CodexPluginStatus | null = { state: 'off' };
const readCodexPluginStatus = vi.fn(async () => status);
const setCliConfig = vi.fn(async (_request: unknown) => {});
vi.mock('@/lib/project-config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readCodexPluginStatus: () => readCodexPluginStatus(),
  setCliConfig: (request: unknown) => setCliConfig(request),
}));

const snap = (installSkills?: boolean): ConfigSnapshot => ({
  ...emptySnapshot('/home/dev/.hive/config.json'),
  clis: resolveClis({ codex: installSkills === undefined ? {} : { installSkills } }),
});

describe('CodexPluginGroup (HIVE-372)', () => {
  beforeEach(() => {
    status = { state: 'off' };
    readCodexPluginStatus.mockClear();
    setCliConfig.mockClear();
  });

  it('is off by default and says what Codex will do, on this Mac', async () => {
    render(<CodexPluginGroup snapshot={snap()} server={null} />);
    const toggle = screen.getByRole('switch', { name: /Install HiveTTY's skills into Codex/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    const description = screen.getByText(/On this Mac, Codex will write to ~\/\.codex/);
    expect(description).toHaveTextContent(/also load when Codex runs outside HiveTTY/);
    expect(description).toHaveTextContent(/Turning this off removes the plugin/);
    await waitFor(() => expect(readCodexPluginStatus).toHaveBeenCalled());
    expect(screen.queryByText(/Installed as/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the attached server instead of this Mac', async () => {
    render(<CodexPluginGroup snapshot={snap()} server="studio-mini" />);
    expect(screen.getByText(/On studio-mini, Codex will write/)).toBeInTheDocument();
    await waitFor(() => expect(readCodexPluginStatus).toHaveBeenCalled());
  });

  it('reads the setting from the snapshot', async () => {
    render(<CodexPluginGroup snapshot={snap(true)} server={null} />);
    expect(screen.getByRole('switch', { name: /Install HiveTTY's skills/ })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(readCodexPluginStatus).toHaveBeenCalled());
  });

  it('turns it on through setCli and re-reads the status', async () => {
    render(<CodexPluginGroup snapshot={snap()} server={null} />);
    await waitFor(() => expect(readCodexPluginStatus).toHaveBeenCalledTimes(1));
    status = { state: 'installed', version: '0.42.0+3f9c1a7e' };
    await userEvent.click(screen.getByRole('switch', { name: /Install HiveTTY's skills/ }));
    expect(setCliConfig).toHaveBeenCalledWith({ cli: 'codex', installSkills: true });
    expect(await screen.findByText(/Installed as hive@hivetty 0\.42\.0\+3f9c1a7e/)).toBeInTheDocument();
    expect(readCodexPluginStatus).toHaveBeenCalledTimes(2);
  });

  it('shows a failed command with Codex’s own message', async () => {
    status = { state: 'failed', command: 'codex plugin add hive@hivetty', message: 'Error: plugin `hive` was not found' };
    render(<CodexPluginGroup snapshot={snap(true)} server={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'codex plugin add hive@hivetty failed: Error: plugin `hive` was not found',
    );
  });
});
