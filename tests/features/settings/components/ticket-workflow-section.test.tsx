import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptySnapshot } from '@shared/config-contract';

import { TicketWorkflowSection } from '@features/settings/components/ticket-workflow-section';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';
import { useUiStore } from '@stores/ui-store';

vi.mock('@hooks/use-skills', () => ({
  useSkills: () => ({ skills: [{ name: 'work-on' }], invalid: [], skillsRoot: '' }),
  useCliSkills: () => null,
}));
vi.mock('@hooks/use-agents', () => ({ useAgents: () => ({ agents: [], agentsRoot: '' }) }));

const base = emptySnapshot('/tmp/hive/config.json');

beforeEach(() => {
  useUiStore.getState().reset();
});

afterEach(() => {
  resetProjectConfig();
});

describe('TicketWorkflowSection (HIVE-379)', () => {
  it('renders header-only without a bridge, which is the browser demo', () => {
    render(<TicketWorkflowSection />);

    expect(screen.getByRole('heading', { name: 'Ticket workflow', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('holds the workflow controls, reading the saved workflow', () => {
    setProjectConfigForTest({
      ...base,
      jira: { ...base.jira, site: 'acme.atlassian.net', workflow: { kind: 'skill', skill: 'hive:work-on' } },
    });
    render(<TicketWorkflowSection />);

    expect(screen.getByRole('radio', { name: 'Run a skill' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: 'Integrations' })).not.toBeInTheDocument();
  });

  it('renders with no Jira site, and points at Integrations', () => {
    setProjectConfigForTest(base);
    render(<TicketWorkflowSection />);

    expect(screen.getByRole('radio', { name: 'Just open' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }));
    expect(useUiStore.getState().settingsSection).toBe('integrations');
  });
});
