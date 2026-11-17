import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptySnapshot, type ConfigSnapshot } from '@shared/config-contract';

import { ServerModeSection } from '@features/settings/components/server-mode-section';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';
import { useHiveStore } from '@stores/hive-store';

/**
 * Machines › Server mode (HIVE-380): `ServerModeGroup` on its own pane. The
 * group's behaviour is `server-mode-group.test.tsx`'s; this proves the pane
 * hands it the snapshot and says whose settings it shows while attached.
 */

const readAppInfo = vi.fn();
vi.mock('@/lib/project-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-config')>();
  return { ...actual, readAppInfo: () => readAppInfo() };
});

const install = (over: Partial<ConfigSnapshot> = {}): void => {
  setProjectConfigForTest({ ...emptySnapshot('/Users/me/.hivetty/config.json'), ...over });
};

beforeEach(() => {
  vi.clearAllMocks();
  readAppInfo.mockResolvedValue(null);
  install();
});

afterEach(() => {
  resetProjectConfig();
  useHiveStore.getState().setRemoteLink(null);
});

describe('ServerModeSection', () => {
  it('wires the relay switch, its status and its lock (HIVE-429)', async () => {
    const base = emptySnapshot('/x');
    install({ server: { ...base.server, enabled: true, relay: { enabled: true } } });
    // No licence gate in this test: useEntitlement('relay') locks nothing.
    (window as { hive?: unknown }).hive = {
      relay: {
        status: () => Promise.resolve({ state: 'pending-launch' }),
        onStatus: () => () => undefined,
      },
      appInfo: () => Promise.resolve({ gateOff: true }),
      licence: { state: () => Promise.resolve(null), onChanged: () => () => undefined },
      config: { getRemote: () => new Promise(() => undefined) },
    };
    try {
      render(<ServerModeSection />);
      const relay = screen.getByRole('switch', { name: 'Reachable through HiveTTY relay' });
      expect(relay).toBeChecked();
      expect(relay).toBeEnabled();
      expect(await screen.findByText('Starts at next launch, with serving.')).toBeInTheDocument();
    } finally {
      delete (window as { hive?: unknown }).hive;
    }
  });

  it('holds the serve and attach halves', () => {
    render(<ServerModeSection />);

    expect(screen.getByRole('heading', { name: 'Server mode', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Serve this machine' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /attach to a server/i })).toBeInTheDocument();
  });

  it('reads the serve half from the snapshot', () => {
    const base = emptySnapshot('/x');
    install({ server: { ...base.server, enabled: true } });
    render(<ServerModeSection />);

    expect(screen.getByRole('switch', { name: 'Serve this machine' })).toBeChecked();
  });

  it('says whose settings these are while attached', () => {
    const base = emptySnapshot('/x');
    install({ server: { ...base.server, enabled: true } });
    // `useAttachedServer` follows the pushed link (HIVE-150).
    useHiveStore.getState().setRemoteLink({
      state: 'attached',
      serverName: 'mini.tail1234.ts.net',
      attempt: 0,
      nextAttemptAt: null,
      reason: null,
      epoch: 0,
      lost: 0,
    });
    render(<ServerModeSection />);

    expect(screen.getByText(/the server's bind settings, not this window's own/i)).toBeInTheDocument();
  });

  it('degrades to a sentence with no bridge', () => {
    setProjectConfigForTest(null);
    render(<ServerModeSection />);

    expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Serve this machine' })).not.toBeInTheDocument();
  });
});
