import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emptySnapshot,
  type ConfigSnapshot,
  type EnvDiagnostic,
  type ProjectConfig,
} from '@shared/config-contract';

import type { LoginEnvStatus } from '@shared/ipc-contract';

import { ShellSection } from '@features/settings/components/shell-section';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';

import { testProjectKey } from '@tests/support/project-key';

const setRuntimeConfig = vi.fn();
const diagnoseSessionEnv = vi.fn();
const readLoginEnvStatus = vi.fn<() => Promise<LoginEnvStatus | null>>();

vi.mock('@/lib/project-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-config')>();
  return {
    ...actual,
    setRuntimeConfig: (request: unknown) => setRuntimeConfig(request),
    diagnoseSessionEnv: (request: unknown) => diagnoseSessionEnv(request),
    readLoginEnvStatus: () => readLoginEnvStatus(),
  };
});

/**
 * What `integrations.loginEnv()` answers.
 *
 * The pane reads this verb and not `integrations.status()`: the status verb
 * carries the same field behind two `spawnSync` calls looking for `gh`, and
 * this pane wants the environment, not the binary.
 */
const loginEnvStatus = (over: Partial<LoginEnvStatus> = {}): LoginEnvStatus => ({
  enabled: true,
  imported: true,
  shell: '/bin/zsh',
  inheritedEntries: 4,
  effectiveEntries: 12,
  varsImported: ['PATH'],
  error: null,
  ...over,
});

const entry = (over: Partial<ProjectConfig> & { id: string }): ProjectConfig => ({
  name: over.id,
  path: `/repos/${over.id}`,
  icon: 'ph-folder',
  origin: 'local',
  status: 'ok',
  key: testProjectKey(over.id),
  isRepo: true,
  ...over,
});

const snapshot = (over: Partial<ConfigSnapshot> = {}): ConfigSnapshot => ({
  ...emptySnapshot('/tmp/hive/config.json'),
  shell: '/bin/sh',
  claudeCommand: 'claude',
  ...over,
});

const install = (over: Partial<ConfigSnapshot> = {}) => {
  setProjectConfigForTest(snapshot(over));
};

beforeEach(() => {
  vi.clearAllMocks();
  diagnoseSessionEnv.mockResolvedValue(null);
  readLoginEnvStatus.mockResolvedValue(loginEnvStatus());
  resetProjectConfig();
});

afterEach(() => {
  resetProjectConfig();
});

describe('ShellSection — the pane (HIVE-377)', () => {
  it('is titled Runtime and says it applies to every CLI', () => {
    install();
    render(<ShellSection />);
    expect(screen.getByRole('heading', { name: 'Runtime', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/every CLI/)).toBeInTheDocument();
  });
  it('has no project picker: overrides open from the project row (HIVE-377)', () => {
    install({ projects: [entry({ id: 'scratch' })] });
    render(<ShellSection />);
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
    expect(screen.getByText(/Workspace › Projects › ⋯ › Runtime overrides/)).toBeInTheDocument();
  });
});

describe('ShellSection — defaults', () => {
  it('shows the current shell, and no global agent command: it moved to Claude Code (HIVE-376)', () => {
    install({ shell: '/bin/zsh', claudeCommand: 'my-claude' });
    render(<ShellSection />);

    expect(screen.getByRole('textbox', { name: 'Shell' })).toHaveValue('/bin/zsh');
    expect(screen.queryByRole('textbox', { name: 'Agent command' })).not.toBeInTheDocument();
  });

  it('saves a changed shell on Enter', async () => {
    const user = userEvent.setup();
    install();
    render(<ShellSection />);

    const field = screen.getByRole('textbox', { name: 'Shell' });
    await user.clear(field);
    await user.type(field, '/bin/zsh{Enter}');

    // Only the field that changed — saving one must not restate the other.
    expect(setRuntimeConfig).toHaveBeenCalledWith({ shell: '/bin/zsh' });
  });

  it('does not write when the value is unchanged', async () => {
    const user = userEvent.setup();
    install({ shell: '/bin/sh' });
    render(<ShellSection />);

    await user.type(screen.getByRole('textbox', { name: 'Shell' }), '{Enter}');

    // A whole-file atomic write for a no-op edit is worth avoiding.
    expect(setRuntimeConfig).not.toHaveBeenCalled();
  });

  it('restores rather than writing an empty top-level value', async () => {
    const user = userEvent.setup();
    install({ shell: '/bin/sh' });
    render(<ShellSection />);

    const field = screen.getByRole('textbox', { name: 'Shell' });
    await user.clear(field);
    await user.type(field, '{Enter}');

    // There is no lower level to inherit from, and a session with no shell
    // cannot start — so the field snaps back instead of writing "".
    expect(setRuntimeConfig).not.toHaveBeenCalled();
    expect(field).toHaveValue('/bin/sh');
  });
});

/**
 * The login-shell import switch (HIVE-84).
 *
 * An escape hatch rather than a preference, so what is worth asserting is that
 * it reflects the stored value, writes the boolean the guard expects, and can
 * actually be turned *off* — a control that only ever writes `true` would look
 * fine and be useless.
 */
describe('ShellSection — login shell environment', () => {
  const findSwitch = () =>
    screen.getByRole('switch', { name: /Import my login shell/ });

  it('reflects the stored value in both directions', () => {
    install({ importLoginEnv: true });
    const { unmount } = render(<ShellSection />);
    expect(findSwitch()).toBeChecked();
    unmount();

    install({ importLoginEnv: false });
    render(<ShellSection />);
    expect(findSwitch()).not.toBeChecked();
  });

  it('writes the boolean, and writes false when switched off', async () => {
    const user = userEvent.setup();
    install({ importLoginEnv: true });
    render(<ShellSection />);

    await user.click(findSwitch());

    // `false`, not an absent field: the guard refuses a coerced value, and an
    // omitted one would mean "leave it alone".
    expect(setRuntimeConfig).toHaveBeenCalledWith({ importLoginEnv: false });
  });

  it('writes true when switched on', async () => {
    const user = userEvent.setup();
    install({ importLoginEnv: false });
    render(<ShellSection />);

    await user.click(findSwitch());

    expect(setRuntimeConfig).toHaveBeenCalledWith({ importLoginEnv: true });
  });

  it('says the change lands on the next launch, because the import runs at boot', () => {
    install();
    render(<ShellSection />);

    expect(
      screen.getByText(/Takes effect on the next launch/),
    ).toBeInTheDocument();
  });
});

describe('ShellSection — workspace environment', () => {
  it('saves a workspace variable through setRuntimeConfig', async () => {
    const user = userEvent.setup();
    install();
    render(<ShellSection />);

    // The only EnvEditor on screen: the per-project one lives in
    // `ProjectOverridesView` (HIVE-377).
    await user.click(screen.getByRole('button', { name: 'Add variable' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Variable 1 name' }),
      'AWS_PROFILE',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Variable 1 value' }),
      'incorp',
    );
    await user.click(screen.getByRole('button', { name: 'Save variables' }));

    expect(setRuntimeConfig).toHaveBeenCalledWith({
      env: { AWS_PROFILE: 'incorp' },
    });
  });

  it('states that the rc file runs afterward and can override these', () => {
    install();
    render(<ShellSection />);

    expect(
      screen.getByText(/rc file runs afterward and can override/i),
    ).toBeInTheDocument();
  });

  it('warns that the config file is plain text, steering credentials elsewhere', () => {
    install();
    render(<ShellSection />);

    // The full requirement is "plain text" *and* the steer toward the rc
    // file for secrets — asserting "plain text" alone would still pass if a
    // copy edit quietly dropped the "tokens and credentials" clause.
    expect(
      screen.getByText(/tokens and credentials.*plain text/i),
    ).toBeInTheDocument();
  });
});

describe('ShellSection — environment diagnostic', () => {
  const kept: EnvDiagnostic = {
    projectId: null,
    shell: '/bin/zsh',
    error: null,
    vars: [{ key: 'AWS_PROFILE', configured: 'hive', actual: 'hive', overridden: false }],
  };

  it('asks about the default environment', async () => {
    const user = userEvent.setup();
    diagnoseSessionEnv.mockResolvedValue(kept);
    install();
    render(<ShellSection />);

    await user.click(
      screen.getByRole('button', { name: 'Check the default environment' }),
    );

    expect(diagnoseSessionEnv).toHaveBeenCalledWith({});
    expect(await screen.findByText('AWS_PROFILE')).toBeInTheDocument();
  });

  it('shows a pending state while the probe is in flight, and clears it after', async () => {
    const user = userEvent.setup();
    // A promise this test controls the resolution of, so the pending state
    // between click and resolution is actually observable — a diagnostic
    // that spawns a real shell can take a second or more, unlike the
    // instant, file-stat-only command diagnostic.
    let resolve!: (value: EnvDiagnostic) => void;
    diagnoseSessionEnv.mockReturnValue(
      new Promise<EnvDiagnostic>((r) => {
        resolve = r;
      }),
    );
    install();
    render(<ShellSection />);

    const button = screen.getByRole('button', { name: 'Check the default environment' });
    await user.click(button);

    expect(await screen.findByRole('button', { name: 'Checking…' })).toHaveAttribute('aria-disabled', 'true');

    resolve(kept);

    expect(
      await screen.findByRole('button', { name: 'Check the default environment' }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('keeps focus on the action while its call runs, and announces the result (HIVE-225)', async () => {
    const user = userEvent.setup();
    let settle!: (value: EnvDiagnostic) => void;
    diagnoseSessionEnv.mockReturnValueOnce(
      new Promise<EnvDiagnostic>((resolve) => {
        settle = resolve;
      }),
    );
    install();
    render(<ShellSection />);
    const button = screen.getByRole('button', { name: 'Check the default environment' });
    await user.click(button);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      settle(kept);
    });
    expect(button).toHaveFocus();
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
  });
});

describe('ShellSection — no bridge', () => {
  it('says shell and environment settings need the desktop app', () => {
    resetProjectConfig();
    render(<ShellSection />);

    expect(
      screen.getByRole('heading', { name: 'Runtime', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/only available in the desktop app/),
    ).toBeInTheDocument();
  });
});

/**
 * The group that arrived from Integrations.
 *
 * It reports the environment every session spawns into, and the switch that
 * decides it — "Login shell environment" — has always been in this pane. So the
 * pane that owned the answer could not own the control, and had to send the
 * reader here by name. These assert the two facts that fixed that: it is
 * mounted here, and it reads the environment rather than inventing it.
 */
describe('ShellSection — PATH source', () => {
  it('renders the group, under the switch that decides it', async () => {
    setProjectConfigForTest(snapshot());

    render(<ShellSection />);

    expect(
      await screen.findByRole('heading', { name: 'PATH source' }),
    ).toBeInTheDocument();
  });

  it('reports the shell the environment came from', async () => {
    setProjectConfigForTest(snapshot());

    render(<ShellSection />);

    expect(
      await screen.findByText(/Imported from your login shell/),
    ).toBeInTheDocument();
    expect(screen.getByText('/bin/zsh')).toBeInTheDocument();
  });

  it('reports the launch, so it cannot contradict the switch above it', async () => {
    readLoginEnvStatus.mockResolvedValue(
      loginEnvStatus({
        enabled: false,
        imported: false,
        shell: null,
        varsImported: [],
        effectiveEntries: 4,
      }),
    );
    setProjectConfigForTest(snapshot());

    render(<ShellSection />);

    expect(
      await screen.findByText(/was off when this app started/),
    ).toBeInTheDocument();
    // Never a pointer to the pane the reader is already standing in.
    expect(screen.queryByText(/Settings → Runtime/)).not.toBeInTheDocument();
  });

  /**
   * One read per open, not one per save.
   *
   * Every write in this pane installs a fresh `ConfigSnapshot`, and an effect
   * depending on it would re-read on each committed keystroke.
   */
  it('asks main once, however many times the snapshot changes', async () => {
    setProjectConfigForTest(snapshot());

    const { rerender } = render(<ShellSection />);
    await screen.findByRole('heading', { name: 'PATH source' });

    setProjectConfigForTest(snapshot({ shell: '/bin/bash' }));
    rerender(<ShellSection />);

    expect(readLoginEnvStatus).toHaveBeenCalledTimes(1);
  });

  it('asks main for nothing when there is no snapshot to ask about', () => {
    render(<ShellSection />);

    expect(readLoginEnvStatus).not.toHaveBeenCalled();
  });
});

/**
 * The failure the pane could not previously show.
 *
 * `readLoginEnvStatus` answers `null` for a failed channel as well as for a
 * missing bridge, so a pane storing that verbatim would say it was checking
 * forever. The reader collapses it to an explicit unavailable state.
 */
describe('ShellSection — PATH source, unavailable', () => {
  it('reports a failed read instead of checking forever', async () => {
    readLoginEnvStatus.mockResolvedValue(null);
    setProjectConfigForTest(snapshot());

    render(<ShellSection />);

    expect(
      await screen.findByText(/could not be asked what environment it is using/),
    ).toBeInTheDocument();
  });
});
