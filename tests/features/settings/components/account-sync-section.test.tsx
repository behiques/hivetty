import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountSyncSection } from '@features/settings/components/account-sync-section';
import { NO_ENCRYPTION, RESET_ELSEWHERE, WRONG_PASSPHRASE, type SyncStatus } from '@shared/sync-contract';

/** The Account center's Sync tab (HIVE-284), one test per state of the approved mockup. */

const status = vi.hoisted(() => ({ current: null as unknown }));
const entitlement = vi.hoisted(() => ({ current: { allowed: true } as unknown }));
const lib = vi.hoisted(() => ({
  setupSync: vi.fn(),
  setSyncGroup: vi.fn(() => Promise.resolve()),
  syncNow: vi.fn(() => Promise.resolve()),
  resetSync: vi.fn((): Promise<{ ok: boolean; error?: string }> => Promise.resolve({ ok: true })),
  openSyncConflicts: vi.fn(() => Promise.resolve()),
}));
vi.mock('@hooks/use-sync-status', () => ({ useSyncStatus: () => status.current }));
vi.mock('@hooks/use-entitlement', () => ({ useEntitlement: () => entitlement.current }));
vi.mock('@lib/sync', () => lib);

const ON = (overrides: Partial<Extract<SyncStatus, { kind: 'on' }>> = {}): SyncStatus => ({
  kind: 'on',
  lastSyncedAt: Date.now() - 2 * 60_000,
  groups: { harnesses: true, automation: true, workspace: true },
  conflicts: { count: 0, latest: null },
  problem: null,
  ...overrides,
});

beforeEach(() => {
  entitlement.current = { allowed: true };
  status.current = null;
  for (const fn of Object.values(lib)) fn.mockClear();
  lib.setupSync.mockResolvedValue({ ok: true });
});

const type = async (label: string | RegExp, text: string) => {
  await userEvent.type(screen.getByLabelText(label), text);
};

describe('AccountSyncSection', () => {
  it('shows the plan lock and nothing else without the feature', () => {
    entitlement.current = { allowed: false, reason: 'Sync is part of Pro.', plan: 'Pro', upgradeUrl: '/upgrade' };
    status.current = ON();
    render(<AccountSyncSection />);
    expect(screen.getByRole('note')).toHaveTextContent('Sync is part of Pro.');
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
  });

  it('asks to sign in when signed out, and says why without keychain encryption', () => {
    status.current = { kind: 'unavailable', reason: 'signed-out' };
    const { unmount } = render(<AccountSyncSection />);
    expect(screen.getByText('Sign in to use sync.')).toBeInTheDocument();
    unmount();
    status.current = { kind: 'unavailable', reason: 'no-encryption' };
    render(<AccountSyncSection />);
    expect(screen.getByText(NO_ENCRYPTION)).toBeInTheDocument();
  });

  it('shows the set-up form while the cloud has nothing, and turns on only with a matching long passphrase', async () => {
    status.current = { kind: 'off', cloud: 'none', resetElsewhere: false };
    render(<AccountSyncSection />);
    expect(screen.getByRole('heading', { name: 'Your setup, on every Mac' })).toBeInTheDocument();
    expect(screen.getByText(/It can't be recovered/)).toBeInTheDocument();
    for (const label of ['Harnesses', 'Automation', 'Appearance & preferences']) expect(screen.getByText(label)).toBeInTheDocument();
    const turnOn = screen.getByRole('button', { name: 'Turn on sync' });
    expect(turnOn).toBeDisabled();
    await type('Sync passphrase', 'elevenchars');
    await type('Type it again', 'elevenchars');
    expect(turnOn).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Type it again'));
    await type('Sync passphrase', 'X');
    await type('Type it again', 'elevencharsY');
    expect(turnOn).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Type it again'));
    await type('Type it again', 'elevencharsX');
    expect(turnOn).toBeEnabled();
    expect(screen.getByLabelText('Sync passphrase')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Sync passphrase')).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.click(turnOn);
    expect(lib.setupSync).toHaveBeenCalledWith('elevencharsX');
    expect(screen.getByLabelText('Sync passphrase')).toHaveValue('');
    expect(screen.getByLabelText('Type it again')).toHaveValue('');
  });

  it('shows the set-up form while the cloud is unknown, with the reset notice when there was one', () => {
    status.current = { kind: 'off', cloud: 'unknown', resetElsewhere: true };
    render(<AccountSyncSection />);
    expect(screen.getByText(RESET_ELSEWHERE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on sync' })).toBeInTheDocument();
  });

  it('shows a set-up error under the form', async () => {
    status.current = { kind: 'off', cloud: 'none', resetElsewhere: false };
    lib.setupSync.mockResolvedValue({ ok: false, error: "Can't reach HiveTTY" });
    render(<AccountSyncSection />);
    await type('Sync passphrase', 'correct horse battery');
    await type('Type it again', 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on sync' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach HiveTTY");
  });

  it('does not turn sync on when focus leaves the matching fields, and Enter then blur sets up once', async () => {
    status.current = { kind: 'off', cloud: 'none', resetElsewhere: false };
    let finish: (value: { ok: boolean }) => void = () => undefined;
    lib.setupSync.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<AccountSyncSection />);
    await type('Sync passphrase', 'correct horse battery');
    await type('Type it again', 'correct horse battery');
    await userEvent.tab();
    expect(lib.setupSync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Type it again'));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    expect(lib.setupSync).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
  });

  it('says so when the set-up call answers nothing', async () => {
    status.current = { kind: 'off', cloud: 'none', resetElsewhere: false };
    lib.setupSync.mockResolvedValue(null);
    render(<AccountSyncSection />);
    await type('Sync passphrase', 'correct horse battery');
    await type('Type it again', 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on sync' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach sync. Try again.");
  });

  it('a join does not run on blur, and runs once while pending', async () => {
    status.current = { kind: 'off', cloud: 'present', resetElsewhere: false };
    let finish: (value: { ok: boolean }) => void = () => undefined;
    lib.setupSync.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<AccountSyncSection />);
    await type('Sync passphrase', 'correct horse battery');
    await userEvent.tab();
    expect(lib.setupSync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Sync passphrase'));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');
    expect(lib.setupSync).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
  });

  it('joins an account that already syncs, and shows a wrong passphrase under the field', async () => {
    status.current = { kind: 'off', cloud: 'present', resetElsewhere: false };
    lib.setupSync.mockResolvedValueOnce({ ok: false, error: WRONG_PASSPHRASE });
    render(<AccountSyncSection />);
    expect(screen.getByRole('heading', { name: 'This account already syncs' })).toBeInTheDocument();
    expect(screen.getByText("What happens to this Mac's setup")).toBeInTheDocument();
    expect(screen.queryByLabelText('Type it again')).toBeNull();
    const field = screen.getByLabelText('Sync passphrase');
    expect(field).toHaveAttribute('autocomplete', 'off');
    await type('Sync passphrase', 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Join sync' }));
    expect(screen.getByRole('alert')).toHaveTextContent(WRONG_PASSPHRASE);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Reset sync' })).toBeInTheDocument();
  });

  it('shows sync on: last synced, Sync now, the switches and no conflicts', async () => {
    status.current = ON();
    render(<AccountSyncSection />);
    expect(screen.getByText('Sync is on')).toBeInTheDocument();
    expect(screen.getByText('Last synced 2 min ago · encrypted with your passphrase')).toBeInTheDocument();
    expect(screen.getByText('No conflicts kept.')).toBeInTheDocument();
    expect(screen.getByText(/Never synced:/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(lib.syncNow).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('switch', { name: /Appearance & preferences/ }));
    expect(lib.setSyncGroup).toHaveBeenCalledWith({ group: 'workspace', on: false });
  });

  it('says not synced yet, and a problem replaces the second line; offline keeps the time', () => {
    status.current = ON({ lastSyncedAt: null });
    const { unmount } = render(<AccountSyncSection />);
    expect(screen.getByText('Not synced yet')).toBeInTheDocument();
    unmount();
    status.current = ON({ problem: 'too-large' });
    const second = render(<AccountSyncSection />);
    expect(screen.getByText(/over 5 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/encrypted with your passphrase/)).toBeNull();
    second.unmount();
    status.current = ON({ problem: 'offline' });
    render(<AccountSyncSection />);
    expect(screen.getByText("Can't reach HiveTTY · last synced 2 min ago")).toBeInTheDocument();
  });

  it('counts kept conflicts, names the latest and opens the folder', async () => {
    status.current = ON({ conflicts: { count: 2, latest: { path: 'skills/review/SKILL.md', at: Date.now() - 60 * 60_000 } } });
    render(<AccountSyncSection />);
    expect(screen.getByText('2 conflicts kept')).toBeInTheDocument();
    expect(screen.getByText('skills/review/SKILL.md · 1 hr ago')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(lib.openSyncConflicts).toHaveBeenCalled();
  });

  it('says one conflict in the singular', () => {
    status.current = ON({ conflicts: { count: 1, latest: { path: 'claudeCommand', at: Date.now() } } });
    render(<AccountSyncSection />);
    expect(screen.getByText('1 conflict kept')).toBeInTheDocument();
  });

  it('says before the confirm that the passphrase cannot be recovered and that Reset deletes the cloud copy', () => {
    status.current = ON();
    render(<AccountSyncSection />);
    expect(
      screen.getByText(
        "Forgot the passphrase? It can't be recovered. Reset deletes the cloud copy, and this Mac's setup becomes the new start.",
      ),
    ).toBeInTheDocument();
  });

  it('resets only after the confirm, and Cancel calls nothing', async () => {
    status.current = ON();
    render(<AccountSyncSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset sync' }));
    expect(screen.getByText('Reset sync?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(lib.resetSync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reset sync' }));
    const dialog = screen.getByText('Reset sync?').closest('div')?.parentElement ?? document.body;
    await userEvent.click(within(dialog as HTMLElement).getByRole('button', { name: 'Reset sync' }));
    expect(lib.resetSync).toHaveBeenCalledTimes(1);
  });

  it('shows a reset that failed', async () => {
    status.current = ON();
    lib.resetSync.mockResolvedValueOnce({ ok: false, error: "Couldn't reset sync. Try again." });
    render(<AccountSyncSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset sync' }));
    await act(async () => {
      await userEvent.click(screen.getAllByRole('button', { name: 'Reset sync' }).at(-1)!);
    });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reset sync. Try again.");
  });

  it('shows a reset the bridge could not answer', async () => {
    status.current = ON();
    lib.resetSync.mockResolvedValueOnce(null as unknown as { ok: boolean });
    render(<AccountSyncSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset sync' }));
    await act(async () => {
      await userEvent.click(screen.getAllByRole('button', { name: 'Reset sync' }).at(-1)!);
    });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach sync. Try again.");
  });

  it('keeps every control reachable in a container narrower than the two-column breakpoint', () => {
    status.current = ON({ conflicts: { count: 1, latest: { path: 'claudeCommand', at: Date.now() } } });
    const { unmount } = render(
      <div style={{ width: '320px' }}>
        <AccountSyncSection />
      </div>,
    );
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeVisible();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset sync' })).toBeVisible();
    unmount();
    status.current = { kind: 'off', cloud: 'present', resetElsewhere: false };
    render(
      <div style={{ width: '320px' }}>
        <AccountSyncSection />
      </div>,
    );
    expect(screen.getByRole('button', { name: 'Join sync' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset sync' })).toBeVisible();
  });

  it('renders nothing but a quiet line before the first status arrives', () => {
    render(<AccountSyncSection />);
    expect(screen.getByText('Checking sync…')).toBeInTheDocument();
  });
});
