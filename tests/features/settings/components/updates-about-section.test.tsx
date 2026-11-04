import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptySnapshot } from '@shared/config-contract';
import type { AppInfo } from '@shared/ipc-contract';
import type { UpdateStatus } from '@shared/update-contract';

import {
  UpdatesAboutSection,
  announceLine,
} from '@features/settings/components/updates-about-section';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';

/**
 * General › Updates & about (HIVE-380): the version facts, the update check
 * and What's new, moved out of Advanced unchanged.
 */

const readAppInfo = vi.fn();
vi.mock('@/lib/project-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-config')>();
  return { ...actual, readAppInfo: () => readAppInfo() };
});

const readUpdateStatus = vi.fn();
const checkForUpdates = vi.fn();
vi.mock('@/lib/updates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/updates')>();
  return {
    ...actual,
    readUpdateStatus: () => readUpdateStatus(),
    checkForUpdates: () => checkForUpdates(),
  };
});

const info = (over: Partial<AppInfo> = {}): AppInfo => ({
  version: '0.1.0',
  electron: '38.0.0',
  chrome: '140.0.0',
  node: '22.0.0',
  platform: 'darwin',
  logPath: '/Users/me/Library/Logs/The Hive',
  receiverBoundHost: null,
  serverBoundHost: null,
  servingDeviceCount: 0,
  attachedServerName: null,
  remoteLink: null,
  serving: false,
  ...over,
});

const at = (over: Partial<UpdateStatus>): UpdateStatus => ({
  state: 'idle',
  checked: false,
  currentVersion: '1.1.2',
  availableVersion: '1.2.0',
  percent: null,
  capability: { canCheck: true, mode: 'self-install', reason: 'This copy installs updates itself.' },
  releaseUrl: 'https://example.invalid/releases',
  error: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  readAppInfo.mockResolvedValue(info());
  readUpdateStatus.mockResolvedValue(null);
  checkForUpdates.mockResolvedValue(undefined);
  setProjectConfigForTest(emptySnapshot('/Users/me/.hivetty/config.json'));
});

afterEach(() => {
  resetProjectConfig();
});

describe('UpdatesAboutSection', () => {
  it('shows what this build is made of', async () => {
    render(<UpdatesAboutSection />);

    expect(screen.getByRole('heading', { name: 'Updates & about', level: 2 })).toBeInTheDocument();
    expect(await screen.findByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('38.0.0')).toBeInTheDocument();
    expect(screen.getByText('140.0.0')).toBeInTheDocument();
    expect(screen.getByText('22.0.0')).toBeInTheDocument();
    expect(screen.getByText('darwin')).toBeInTheDocument();
  });

  it('says it is reading rather than inventing versions when the channel fails', async () => {
    readAppInfo.mockResolvedValue(null);
    render(<UpdatesAboutSection />);

    expect(await screen.findByText('Reading…')).toBeInTheDocument();
  });

  it('says updates need the desktop app when there is no status', async () => {
    render(<UpdatesAboutSection />);

    expect(await screen.findByText('Updates are only available in the desktop app.')).toBeInTheDocument();
  });

  it('shows where updates come from, in place of a channel', async () => {
    readUpdateStatus.mockResolvedValue(at({ checked: true }));
    render(<UpdatesAboutSection />);

    expect(await screen.findByText('Version 1.1.2 — up to date.', { selector: 'p:not([role])' })).toBeInTheDocument();
    expect(screen.getByText('This copy installs updates itself.')).toBeInTheDocument();
  });

  it('checks now, then re-reads the status the answer produced', async () => {
    readUpdateStatus.mockResolvedValueOnce(at({}));
    render(<UpdatesAboutSection />);

    readUpdateStatus.mockResolvedValue(at({ state: 'available' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Check now' }));

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Version 1.2.0 is available.', { selector: 'p:not([role])' })).toBeInTheDocument();
  });

  it('disables the check on a copy that cannot check', async () => {
    readUpdateStatus.mockResolvedValue(
      at({ capability: { canCheck: false, mode: 'manual', reason: 'Download it from the releases page.' } }),
    );
    render(<UpdatesAboutSection />);

    expect(await screen.findByRole('button', { name: 'Check now' })).toBeDisabled();
    expect(screen.getByText('Download it from the releases page.')).toBeInTheDocument();
  });

  /** Licences arrive with HIVE-248; no row stands in for them. */
  it('holds no Licences stub', () => {
    render(<UpdatesAboutSection />);

    expect(screen.queryByText(/licen[cs]es?/i)).not.toBeInTheDocument();
  });

  it('degrades to a sentence with no bridge', () => {
    setProjectConfigForTest(null);
    render(<UpdatesAboutSection />);

    expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
    expect(readAppInfo).not.toHaveBeenCalled();
  });
});

/** What's new (1.0): turned back on, or opened, from here. */
describe('UpdatesAboutSection — What’s new', () => {
  it('shows the switch on by default and turns future screens off and on', async () => {
    const { useAppearanceStore } = await import('@stores/appearance-store');
    useAppearanceStore.getState().reset();
    const user = userEvent.setup();
    render(<UpdatesAboutSection />);

    const toggle = screen.getByRole('switch', { name: 'Show What’s new after an update' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(useAppearanceStore.getState().whatsNewOff).toBe(true);
    await user.click(toggle);
    expect(useAppearanceStore.getState().whatsNewOff).toBe(false);
  });

  it('opens the card from Settings', async () => {
    const { useUiStore } = await import('@stores/ui-store');
    const user = userEvent.setup();
    render(<UpdatesAboutSection />);
    await user.click(screen.getByRole('button', { name: 'Open What’s new' }));
    expect(useUiStore.getState().whatsNewOpen).toBe(true);
  });
});

describe('announceLine (HIVE-226)', () => {
  it.each([
    ['checking', at({ state: 'checking' })],
    ['downloading', at({ state: 'downloading', percent: 40 })],
    ['unsupported', at({ state: 'unsupported' })],
    ['idle before any check', at({ state: 'idle', checked: false })],
  ])('says nothing while %s', (_, status) => {
    expect(announceLine(status)).toBe('');
  });

  it('announces each result', () => {
    expect(announceLine(at({ state: 'idle', checked: true }))).toBe('Version 1.1.2 — up to date.');
    expect(announceLine(at({ state: 'available' }))).toBe('Version 1.2.0 is available.');
    expect(announceLine(at({ state: 'ready' }))).toBe('Version 1.2.0 is ready — restart to install.');
    expect(announceLine(at({ state: 'error', error: 'offline' }))).toBe('The last check did not complete.');
  });

  it('shows the download step but announces nothing, then announces the result', async () => {
    readUpdateStatus.mockResolvedValue(at({ state: 'downloading', percent: 40 }));
    const { unmount } = render(<UpdatesAboutSection />);
    const visible = await screen.findByText(/Downloading 1\.2\.0…/);
    expect(visible.closest('[role="status"]')).toBeNull();
    expect(screen.getByTestId('update-announce')).toHaveTextContent(/^$/);
    unmount();

    readUpdateStatus.mockResolvedValue(at({ state: 'ready' }));
    render(<UpdatesAboutSection />);
    await screen.findByText(/is ready — restart to install\. ·/);
    expect(screen.getByTestId('update-announce')).toHaveTextContent('Version 1.2.0 is ready — restart to install.');
  });
});
