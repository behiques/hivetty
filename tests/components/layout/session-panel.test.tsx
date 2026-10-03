import { fireEvent, render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session, Terminal } from '@/types/entity';
import { pickTab, SessionPanel } from '@components/layout/session-panel';
import type { SessionPlan } from '@shared/plan-contract';
import { useAppearanceStore } from '@stores/appearance-store';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { seedDemoFleet } from '@tests/support/demo-fleet';

vi.mock('@features/explorer/components/explorer-panel', () => ({
  ExplorerPanel: ({ changesId }: { changesId?: string }) => <div>explorer {changesId ?? 'none'}</div>,
}));

const plan = (entityId: string): SessionPlan => ({
  entityId,
  source: 'task-tools',
  allDone: false,
  tasks: [
    { id: '1', title: 'Alpha', status: 'completed' },
    { id: '2', title: 'Beta', status: 'in_progress' },
  ],
});

const changed = [
  { path: 'a.ts', mark: 'M' as const, added: 1, removed: 0 },
  { path: 'b.ts', mark: 'A' as const, added: 2, removed: 0 },
];

let narrow = false;

beforeEach(() => {
  narrow = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: narrow,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  useHiveStore.getState().reset();
  seedDemoFleet();
  useUiStore.getState().reset();
  useAppearanceStore.getState().reset();
  useUiStore.getState().openTab('hero-refresh', 'sessions');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tabRow = () => screen.getByRole('tablist');

describe('pickTab', () => {
  it('keeps the persisted tab where it exists, else Plan, else Files', () => {
    expect(pickTab(['plan', 'files'], 'files')).toBe('files');
    expect(pickTab(['plan', 'files'], 'ticket')).toBe('plan');
    expect(pickTab(['files'], 'plan')).toBe('files');
  });
});

describe('SessionPanel (HIVE-201)', () => {
  beforeEach(() => {
    useHiveStore.getState().setPlan('hero-refresh', plan('hero-refresh'));
    useHiveStore.getState().setChangedFiles('hero-refresh', changed);
  });

  it('open on a session with a plan: Plan and Files 2, and the Plan body', () => {
    render(<SessionPanel />);
    const tabs = within(tabRow()).getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Plan', 'Files 2']);
    expect(
      screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.startsWith('1 of 2 tasks') === true),
    ).toBeInTheDocument();
  });

  it('a tab click picks it, and Files shows the explorer for main’s id', () => {
    render(<SessionPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'Files 2' }));
    expect(useAppearanceStore.getState().sessionPanelTab).toBe('files');
    expect(screen.getByText('explorer hero-refresh')).toBeInTheDocument();
  });

  it('the chevron closes it to the strip, and a strip icon opens that tab', () => {
    render(<SessionPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Close the session panel' }));
    expect(useAppearanceStore.getState().sessionPanelOpen).toBe(false);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: 'Plan, 1 of 2 done' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2 files changed' }));
    expect(useAppearanceStore.getState()).toMatchObject({ sessionPanelOpen: true, sessionPanelTab: 'files' });
  });

  it('with no plan, the persisted Plan tab falls back to Files', () => {
    useHiveStore.getState().setPlan('hero-refresh', null);
    render(<SessionPanel />);
    expect(within(tabRow()).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Files 2']);
    expect(screen.getByText('explorer hero-refresh')).toBeInTheDocument();
  });

  it('a narrow window keeps the strip even when open', () => {
    narrow = true;
    render(<SessionPanel />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Session panel' })).toBeInTheDocument();
  });

  it('draws nothing at home, or on the overmind', () => {
    act(() => {
      useUiStore.getState().selectPlace('home');
    });
    const { container, unmount } = render(<SessionPanel />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    act(() => {
      useUiStore.getState().openTab('orch');
    });
    expect(render(<SessionPanel />).container).toBeEmptyDOMElement();
  });

  it('after /clear, reads the plan and files main published under the terminal id (R2)', () => {
    const base = useHiveStore.getState().entities['hero-refresh'] as Session;
    const successor: Session = { ...base, id: 'hero-2', terminalId: 'hero-refresh' };
    act(() => {
      useHiveStore.setState((state) => ({ entities: { ...state.entities, 'hero-2': successor } }));
      useUiStore.getState().openTab('hero-2', 'sessions');
    });
    render(<SessionPanel />);
    expect(within(tabRow()).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Plan', 'Files 2']);
  });
});

describe('SessionPanel: a terminal (HIVE-201)', () => {
  beforeEach(() => {
    const terminal: Terminal = {
      kind: 'terminal',
      id: 't1',
      project: 'nova-web',
      cwd: '/repos/nova-web',
      status: 'prompt',
      createdAt: 1,
      lines: [],
    };
    act(() => {
      useHiveStore.setState((state) => ({ entities: { ...state.entities, t1: terminal } }));
      useUiStore.getState().openTab('t1', 'sessions');
    });
  });

  it('gets Files only, open and closed', () => {
    render(<SessionPanel />);
    expect(within(tabRow()).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Files']);
    expect(screen.getByText('explorer none')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close the session panel' }));
    expect(screen.queryByRole('button', { name: /^Plan/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
  });
});
