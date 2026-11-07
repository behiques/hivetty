import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@/app';
import { useAppearanceStore } from '@stores/appearance-store';
import { useUiStore } from '@stores/ui-store';

vi.mock('@xterm/xterm');
vi.mock('@xterm/addon-fit');

/**
 * The composition root is a one-liner since story 020 — it mounts the shell and
 * nothing else. The regions themselves are pinned in
 * `tests/components/layout/app-shell.test.tsx`.
 */
describe('App', () => {
  beforeEach(() => {
    document.body.removeAttribute('data-theme');
    useUiStore.getState().reset();
    useAppearanceStore.getState().reset();
  });

  it('mounts the app shell', () => {
    render(<App />);

    expect(screen.getByRole('navigation', { name: 'Places' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });

  it('with a bridge and no licence, no workspace mounts (HIVE-265)', async () => {
    (window as { hive?: unknown }).hive = {
      appInfo: () => Promise.resolve({}),
      account: {
        state: () => Promise.resolve({ kind: 'signed-out' }),
        onChanged: () => () => undefined,
        onDeviceCode: () => () => undefined,
      },
      licence: { state: () => Promise.resolve({ kind: 'unlicensed' }), onChanged: () => () => undefined },
      appQuit: vi.fn(),
    };
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to HiveTTY Pro' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Places' })).toBeNull();
    delete (window as { hive?: unknown }).hive;
  });
});
