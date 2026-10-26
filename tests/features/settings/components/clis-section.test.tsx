import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClis } from '@shared/cli-contract';
import { emptySnapshot } from '@shared/config-contract';

import { ClisSection } from '@features/settings/components/clis-section';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';

const setCliAgentsConfig = vi.fn();

vi.mock('@/lib/project-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-config')>();
  return { ...actual, setCliAgentsConfig: (request: unknown) => setCliAgentsConfig(request) };
});

const seed = (agents: Parameters<typeof resolveClis>[0]) =>
  setProjectConfigForTest({ ...emptySnapshot('/home/dev/.hive/config.json'), clis: resolveClis(agents) });

describe('ClisSection (HIVE-341)', () => {
  beforeEach(() => setCliAgentsConfig.mockReset());
  afterEach(() => resetProjectConfig());

  it('renders a Headless agents group per CLI', () => {
    seed(undefined);
    render(<ClisSection />);

    expect(screen.getByRole('region', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Headless agents' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enabled for agents' })).toBeChecked();
    expect(screen.getByLabelText('Model')).toHaveValue('');
    expect(screen.getByLabelText('Model')).toBeEnabled();
  });

  it('turning it off writes enabled: false', async () => {
    seed(undefined);
    render(<ClisSection />);

    await userEvent.click(screen.getByRole('switch', { name: 'Enabled for agents' }));

    expect(setCliAgentsConfig).toHaveBeenCalledWith({ cli: 'claude-code', enabled: false });
  });

  it('a model writes the model, and CLI default writes null', async () => {
    seed({ 'claude-code': { agents: { effort: 'high' } } });
    render(<ClisSection />);

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
    seed({ 'claude-code': { agents: { enabled: false } } });
    render(<ClisSection />);

    expect(screen.getByLabelText('Model')).toBeDisabled();
    expect(screen.getByLabelText('Effort')).toBeDisabled();
    expect(screen.getByText(/agents skip Claude Code/)).toBeInTheDocument();
  });

  it('says it needs the desktop app before the config has loaded', () => {
    resetProjectConfig();
    render(<ClisSection />);

    expect(screen.getByText('CLI settings are only available in the desktop app.')).toBeInTheDocument();
  });
});
