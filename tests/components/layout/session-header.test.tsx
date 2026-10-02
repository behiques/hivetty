import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/types/entity';

import { SessionHeader } from '@components/layout/session-header';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { seedDemoFleet } from '@tests/support/demo-fleet';

const hero = () => useHiveStore.getState().entities['hero-refresh'] as Session;

describe('SessionHeader (HIVE-197)', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    useUiStore.getState().reset();
    seedDemoFleet();
  });

  it('reads ‹ Overmind, the title over project · branch, the status and an empty model slot', () => {
    render(<SessionHeader entity={hero()} />);
    expect(screen.getByRole('button', { name: 'Back to overmind' })).toHaveTextContent('Overmind');
    expect(screen.getByText('hero-refresh')).toHaveAttribute('title', hero().task);
    expect(screen.getByText('nova-web · feat/hero-refresh')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
    expect(screen.getByTestId('session-header').querySelector('[data-slot="model"]')).toBeEmptyDOMElement();
  });

  it('‹ Overmind goes back and selects the session', async () => {
    useUiStore.setState({ activeTab: 'hero-refresh' });
    render(<SessionHeader entity={hero()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Back to overmind' }));
    expect(useUiStore.getState().activeTab).toBe('orch');
    expect(useUiStore.getState().selId).toBe('hero-refresh');
  });

  it('the menu holds Terminal here', async () => {
    const spawn = vi.fn();
    useHiveStore.setState({ spawnTerminalBeside: spawn });
    render(<SessionHeader entity={hero()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Session menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Terminal here/ }));
    expect(spawn).toHaveBeenCalledWith('hero-refresh');
  });
});
