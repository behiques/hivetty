import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyHatchery } from '@features/pull-requests/components/empty-hatchery';
import { useUiStore } from '@stores/ui-store';

const motion = { reduced: false };
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => motion.reduced }));

beforeEach(() => {
  motion.reduced = false;
  useUiStore.getState().reset();
});

describe('EmptyHatchery', () => {
  it('says the Hatchery is quiet and what comes next', () => {
    render(<EmptyHatchery />);
    expect(screen.getByRole('heading', { name: 'The Hatchery is quiet' })).toBeInTheDocument();
    expect(screen.getByText(/No pull request is open, in draft, or merged in the last 24 hours\./)).toBeInTheDocument();
    expect(screen.getByText(/The next one hatches here when a session or the builder opens it\./)).toBeInTheDocument();
  });

  it('Search older PRs opens the panel with the search', async () => {
    render(<EmptyHatchery />);
    await userEvent.click(screen.getByRole('button', { name: 'Search older PRs' }));
    expect(useUiStore.getState().prSearchOpen).toBe(true);
  });

  it('sets each button\'s icon beside its label, not above it', () => {
    // Preflight makes an svg a block; without a flex button the icon takes its own line.
    render(<EmptyHatchery />);
    for (const name of ['Search older PRs', 'New session']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\binline-flex\b.*\bitems-center\b/);
    }
  });

  it('New session opens the picker', async () => {
    render(<EmptyHatchery />);
    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(useUiStore.getState().picker).toBe(true);
  });

  it('rocks, cracks and drifts with motion', () => {
    const { container } = render(<EmptyHatchery />);
    expect(container.querySelector('[data-part="egg"]')).toHaveClass('animate-cceggrock');
    expect(container.querySelectorAll('[data-part="spore"]')).toHaveLength(5);
  });

  it('holds still under reduced motion: crack closed, no spores', () => {
    motion.reduced = true;
    const { container } = render(<EmptyHatchery />);
    expect(container.querySelector('[class*="animate-"]')).toBeNull();
    expect(container.querySelector('[data-part="crack"]')).toHaveAttribute('stroke-dashoffset', '100');
    expect(container.querySelectorAll('[data-part="spore"]')).toHaveLength(0);
  });
});
