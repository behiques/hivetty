import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ListPanel } from '@components/layout/list-panel';
import { useUiStore, type Place } from '@stores/ui-store';

vi.mock('@features/projects/components/projects-panel', () => ({ ProjectsPanel: () => <p>projects-panel</p> }));
vi.mock('@features/projects/components/sessions-panel', () => ({ SessionsPanel: () => <p>sessions-panel</p> }));
vi.mock('@features/work/components/work-panel', () => ({
  WorkPanel: () => <p>work-panel</p>,
  WorkList: () => <p>work-list</p>,
}));
vi.mock('@features/agents/components/agents-panel', () => ({ AgentsPanel: () => <p>agents-panel</p> }));
vi.mock('@features/pull-requests/components/prs-panel', () => ({ PrsPanel: () => <p>prs-panel</p> }));

describe('ListPanel (HIVE-195)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  it.each<[Place, string, string]>([
    ['sessions', 'Sessions list', 'sessions-panel'],
    ['work', 'Work list', 'work-list'],
    ['agents', 'Agents list', 'agents-panel'],
    ['prs', 'PRs list', 'prs-panel'],
  ])('mounts %s’s panel', (place, label, marker) => {
    useUiStore.setState({ place });

    render(<ListPanel />);

    const region = screen.getByRole('region', { name: label });
    expect(region).toHaveClass('w-[var(--cc-list-w)]', 'shrink-0', 'bg-panel');
    expect(screen.getByText(marker)).toBeInTheDocument();
  });

  it('draws nothing on Home', () => {
    const { container } = render(<ListPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing when the panel is closed', () => {
    useUiStore.setState({ place: 'work', panelOpen: false });
    const { container } = render(<ListPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
