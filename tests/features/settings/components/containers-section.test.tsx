import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  emptySnapshot,
  type ConfigSnapshot,
  type ContainerConfig,
  type ProjectConfig,
} from '@shared/config-contract';

import { ContainersSection } from '@features/settings/components/containers-section';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';
import { useUiStore } from '@stores/ui-store';

import { testProjectKey } from '@tests/support/project-key';

/** The minimal valid profile, as `container-group.test.tsx` builds it. */
const container: ContainerConfig = { workspace: '/workspace', hiveDir: '/hive' };

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

const install = (over: Partial<ConfigSnapshot> = {}) => {
  setProjectConfigForTest({ ...emptySnapshot('/tmp/hive/config.json'), ...over });
};

beforeEach(() => {
  useUiStore.getState().reset();
  resetProjectConfig();
});

afterEach(() => {
  resetProjectConfig();
});

describe('ContainersSection (HIVE-377)', () => {
  it('lists each CLI with whether it runs in a container', () => {
    install();
    render(<ContainersSection />);
    expect(screen.getByRole('row', { name: /Claude Code/ })).toHaveTextContent('Yes');
    expect(screen.getByRole('row', { name: /Codex/ })).toHaveTextContent('Not supported');
    expect(screen.getByRole('row', { name: /Copilot/ })).toHaveTextContent('Not supported');
  });

  it('opens a CLI’s page from its name', async () => {
    const user = userEvent.setup();
    install();
    render(<ContainersSection />);
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    expect(useUiStore.getState().settingsSection).toBe('codex');
  });

  it('names the projects that run in a container, and points at their overrides', () => {
    install({
      projects: [entry({ id: 'api', name: 'api', container }), entry({ id: 'web', name: 'web' })],
    });
    render(<ContainersSection />);
    expect(screen.getByText(/Running in a container:/)).toHaveTextContent('api');
    expect(screen.getByText(/Running in a container:/)).not.toHaveTextContent('web');
    expect(screen.getByText(/Workspace › Projects › ⋯ › Runtime overrides/)).toBeInTheDocument();
  });

  it('says None yet when no project runs in one', () => {
    install({ projects: [entry({ id: 'web' })] });
    render(<ContainersSection />);
    expect(screen.getByText(/None yet/)).toBeInTheDocument();
  });

  it('holds the alias group', () => {
    install();
    render(<ContainersSection />);
    expect(screen.getByRole('heading', { name: 'Reaching this app', level: 3 })).toBeInTheDocument();
    expect(screen.getByLabelText('Host alias')).toBeInTheDocument();
  });

  it('needs the desktop app', () => {
    resetProjectConfig();
    render(<ContainersSection />);
    expect(screen.getByRole('heading', { name: 'Containers', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/only available in the desktop app/)).toBeInTheDocument();
  });
});
