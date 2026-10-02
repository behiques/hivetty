import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActivityBar } from '@components/layout/activity-bar';
import { TooltipProvider } from '@components/ui/tooltip';
import { useAppearanceStore } from '@stores/appearance-store';
import { useUiStore } from '@stores/ui-store';

const renderBar = () =>
  render(
    <TooltipProvider>
      <ActivityBar />
    </TooltipProvider>,
  );

describe('ActivityBar (HIVE-195)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useAppearanceStore.getState().reset();
  });

  it('lists the five places, Home active on launch', () => {
    renderBar();
    const bar = screen.getByRole('navigation', { name: 'Places' });

    for (const name of ['Home', 'Sessions', 'Work', 'Agents', 'PRs']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Work' })).not.toHaveAttribute('aria-current');
    expect(bar).toHaveClass('w-[var(--cc-bar-w)]');
  });

  it('a click selects the place and marks it active', async () => {
    renderBar();

    await userEvent.click(screen.getByRole('button', { name: 'Work' }));

    expect(useUiStore.getState()).toMatchObject({ place: 'work', panelOpen: true });
    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Work' })).toHaveClass('text-ink', 'bg-panel-2');
    expect(screen.getByRole('button', { name: 'Home' })).toHaveClass('text-muted');
  });

  it('Settings opens settings', async () => {
    renderBar();

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(useUiStore.getState().settings).toBe(true);
  });

  it('names the glyph after the team, or The Hive without one', () => {
    useAppearanceStore.setState({ teamName: 'Platform' });
    const { unmount } = renderBar();
    expect(screen.getByRole('img', { name: 'Platform' })).toBeInTheDocument();
    unmount();

    useAppearanceStore.setState({ teamName: '  ' });
    renderBar();
    expect(screen.getByRole('img', { name: 'The Hive' })).toBeInTheDocument();
  });

  it('shows the team name in a tooltip', async () => {
    useAppearanceStore.setState({ teamName: 'Platform' });
    renderBar();

    await userEvent.hover(screen.getByRole('img', { name: 'Platform' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Platform');
  });
});
