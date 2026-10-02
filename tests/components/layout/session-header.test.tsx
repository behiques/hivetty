import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session, Terminal } from '@/types/entity';

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

  it('over a terminal: the terminal glyph, its name, project · cwd, its state, no model and no menu', () => {
    const t: Terminal = {
      kind: 'terminal',
      id: 'term-5',
      project: 'ai-sdk',
      cwd: '/repos/ai-sdk',
      status: 'prompt',
      createdAt: 1,
      lines: [],
    };
    render(<SessionHeader entity={t} />);
    expect(screen.getByText('term-5')).toHaveClass('font-mono');
    expect(screen.getByText(/^ai-sdk · /)).toBeInTheDocument();
    expect(screen.getByText('at prompt')).toBeInTheDocument();
    expect(screen.getByTestId('session-header').querySelector('[data-slot="model"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Session menu' })).not.toBeInTheDocument();
  });

  it('the menu links the session’s PR', async () => {
    render(<SessionHeader entity={hero()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Session menu' }));
    expect(screen.getByRole('menuitem', { name: /Open PR #482/ })).toHaveAttribute(
      'href',
      expect.stringContaining('482'),
    );
  });
});
