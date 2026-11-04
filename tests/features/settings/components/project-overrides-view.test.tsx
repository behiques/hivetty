import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BIND,
  emptySnapshot,
  type CommandDiagnostic,
  type ConfigSnapshot,
  type ContainerConfig,
  type EnvDiagnostic,
  type ProjectConfig,
} from '@shared/config-contract';

import { ProjectOverridesView } from '@features/settings/components/project-overrides-view';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';

import { testProjectKey } from '@tests/support/project-key';

const setProjectRuntimeConfig = vi.fn();
const diagnoseAgentCommand = vi.fn();
const diagnoseSessionEnv = vi.fn();

vi.mock('@/lib/project-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-config')>();
  return {
    ...actual,
    setProjectRuntimeConfig: (request: unknown) => setProjectRuntimeConfig(request),
    diagnoseAgentCommand: (request: unknown) => diagnoseAgentCommand(request),
    diagnoseSessionEnv: (request: unknown) => diagnoseSessionEnv(request),
  };
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

/** The view for one project, as `ProjectsSection` mounts it. */
const view = (projectId: string) => (
  <ProjectOverridesView projectId={projectId} onDone={vi.fn()} />
);

beforeEach(() => {
  vi.clearAllMocks();
  diagnoseAgentCommand.mockResolvedValue(null);
  diagnoseSessionEnv.mockResolvedValue(null);
  resetProjectConfig();
});

afterEach(() => {
  resetProjectConfig();
});

describe('ProjectOverridesView — the frame (HIVE-377)', () => {
  it('names the project and goes back', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    install({ projects: [entry({ id: 'scratch', name: 'Scratch' })] });
    render(<ProjectOverridesView projectId="scratch" onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Scratch: runtime overrides', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Projects' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Back to Projects' }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('goes back on its own when the project is removed underneath it', () => {
    const onDone = vi.fn();
    install({ projects: [] });
    render(<ProjectOverridesView projectId="scratch" onDone={onDone} />);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('renders nothing, and stays put, with no snapshot (the browser target)', () => {
    const onDone = vi.fn();
    const { container } = render(<ProjectOverridesView projectId="scratch" onDone={onDone} />);
    expect(container).toBeEmptyDOMElement();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('names its env editor for the project', () => {
    install({ projects: [entry({ id: 'scratch' })] });
    render(view('scratch'));
    expect(screen.getByRole('group', { name: 'Project environment variables' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Project environment variables' })).getByRole('button', {
        name: 'Save variables',
      }),
    ).toBeInTheDocument();
  });
});

describe('ProjectOverridesView — per-project overrides', () => {
  it('shows the inherited value as a placeholder, not a value', () => {
    install({ shell: '/bin/sh', projects: [entry({ id: 'nova-web' })] });
    render(view('nova-web'));

    const field = screen.getByRole('textbox', { name: 'Shell override' });
    // Empty means "inherit". Pre-filling the inherited value would turn every
    // opened row into an override the moment it was saved.
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', '/bin/sh');
  });

  it('sets an override', async () => {
    const user = userEvent.setup();
    install({ projects: [entry({ id: 'nova-web' })] });
    render(view('nova-web'));

    await user.type(
      screen.getByRole('textbox', { name: 'Shell override' }),
      '/bin/bash{Enter}',
    );

    expect(setProjectRuntimeConfig).toHaveBeenCalledWith({
      id: 'nova-web',
      shell: '/bin/bash',
    });
  });

  it('clears an override with null rather than an empty string', async () => {
    const user = userEvent.setup();
    install({ projects: [entry({ id: 'nova-web', shell: '/bin/bash' })] });
    render(view('nova-web'));

    const field = screen.getByRole('textbox', { name: 'Shell override' });
    await user.clear(field);
    await user.type(field, '{Enter}');

    // The whole point of the three-state contract: "" would spawn a shell
    // named "", null restores inheritance.
    expect(setProjectRuntimeConfig).toHaveBeenCalledWith({
      id: 'nova-web',
      shell: null,
    });
  });

  it('saves env vars, and clears the key entirely when emptied', async () => {
    const user = userEvent.setup();
    install({ projects: [entry({ id: 'nova-web', env: { FOO: 'bar' } })] });
    render(view('nova-web'));

    // Scoped to the project's own named group, the way the e2e suite finds it.
    const projectGroup = screen.getByRole('group', {
      name: 'Project environment variables',
    });

    await user.click(screen.getByRole('button', { name: 'Remove variable 1' }));
    await user.click(
      within(projectGroup).getByRole('button', { name: 'Save variables' }),
    );

    // `null`, not `{}` — leaving `"env": {}` behind is litter in a file people
    // hand-edit.
    expect(setProjectRuntimeConfig).toHaveBeenCalledWith({
      id: 'nova-web',
      env: null,
    });
  });

  it('reseeds when rerendered for another project', () => {
    install({
      projects: [
        entry({ id: 'scratch', shell: '/bin/bash' }),
        entry({ id: 'other' }),
      ],
    });
    const { rerender } = render(
      <ProjectOverridesView key="scratch" projectId="scratch" onDone={vi.fn()} />,
    );
    expect(screen.getByRole('textbox', { name: 'Shell override' })).toHaveValue('/bin/bash');

    // `ProjectsSection` keys the view by project id, so another project
    // remounts it: a stale override never renders under another project's name.
    rerender(<ProjectOverridesView key="other" projectId="other" onDone={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Shell override' })).toHaveValue('');
  });
});

/**
 * The nested Container group (HIVE-133).
 *
 * `ProjectOverrides` mounts `ContainerGroup` only once the project's
 * `container` block is present — a host project renders nothing here, byte-
 * identical to before this group existed.
 */
describe('ProjectOverridesView — the container group', () => {
  const containerConfig: ContainerConfig = {
    workspace: '/workspace',
    hiveDir: '/hive',
    hostAlias: 'gateway',
  };

  it('does not render for a project with no container block', () => {
    install({ projects: [entry({ id: 'nova-web' })] });
    render(view('nova-web'));

    expect(
      screen.queryByRole('heading', { level: 4, name: 'Container' }),
    ).not.toBeInTheDocument();
  });

  it('renders nested, with the project’s own container fields, once one is set', () => {
    install({
      projects: [entry({ id: 'nova-web', container: containerConfig })],
    });
    render(view('nova-web'));

    // h4, not h3 — the nesting rule this view relies on `SettingsGroup`
    // deriving from context, not from anything `ProjectOverridesView`
    // decides itself.
    expect(
      screen.getByRole('heading', { level: 4, name: 'Container' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace path')).toHaveValue('/workspace');
  });

  it('offers the receiver’s host alias as the blank field’s placeholder', () => {
    install({
      receiver: { hostAlias: 'host.containers.internal', bind: DEFAULT_BIND },
      projects: [
        entry({
          id: 'nova-web',
          container: { workspace: '/workspace', hiveDir: '/hive' },
        }),
      ],
    });
    render(view('nova-web'));

    expect(screen.getByLabelText('Host alias')).toHaveAttribute(
      'placeholder',
      'host.containers.internal',
    );
  });

  it('passes the already-fetched command diagnostic’s container field down, rather than fetching a second one', async () => {
    const user = userEvent.setup();
    diagnoseAgentCommand.mockResolvedValue({
      projectId: 'nova-web',
      command: 'claude',
      isPath: false,
      resolved: '/usr/bin/claude',
      path: '/usr/bin',
      probes: [],
      container: {
        probe: 'docker exec devbox true',
        ok: false,
        exitCode: 1,
        stderr: 'container devbox is not running',
        missingEnvPlaceholder: false,
      },
    });
    install({
      projects: [entry({ id: 'nova-web', container: containerConfig })],
    });
    render(view('nova-web'));

    await user.click(
      screen.getByRole('button', { name: /Check this project’s command/ }),
    );

    // One call altogether — `ContainerGroup` never runs a diagnostic of its
    // own, it only renders the `container` field of the one this pane already
    // ran.
    expect(diagnoseAgentCommand).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/container devbox is not running/),
    ).toBeInTheDocument();
  });
});

describe('ProjectOverridesView — diagnostic', () => {
  const found: CommandDiagnostic = {
    projectId: null,
    command: 'claude',
    isPath: false,
    resolved: '/usr/bin/claude',
    path: '/usr/bin',
    probes: [{ directory: '/usr/bin', found: true }],
  };

  it('asks about this project', async () => {
    const user = userEvent.setup();
    diagnoseAgentCommand.mockResolvedValue({ ...found, projectId: 'nova-web' });
    install({ projects: [entry({ id: 'nova-web' })] });
    render(view('nova-web'));

    await user.click(
      screen.getByRole('button', { name: /Check this project’s command/ }),
    );

    expect(diagnoseAgentCommand).toHaveBeenCalledWith({ id: 'nova-web' });
  });
});

describe('ProjectOverridesView — environment diagnostic', () => {
  const kept: EnvDiagnostic = {
    projectId: null,
    shell: '/bin/zsh',
    error: null,
    vars: [{ key: 'AWS_PROFILE', configured: 'hive', actual: 'hive', overridden: false }],
  };

  it('asks about this project’s environment', async () => {
    const user = userEvent.setup();
    diagnoseSessionEnv.mockResolvedValue({ ...kept, projectId: 'nova-web' });
    install({ projects: [entry({ id: 'nova-web' })] });
    render(view('nova-web'));

    await user.click(
      screen.getByRole('button', { name: 'Check this project’s environment' }),
    );

    expect(diagnoseSessionEnv).toHaveBeenCalledWith({ id: 'nova-web' });
  });
});
