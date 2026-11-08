import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountDevicesSection } from '@features/settings/components/account-devices-section';

const account = vi.hoisted(() => ({ current: null as unknown }));
const licence = vi.hoisted(() => ({ current: null as unknown }));
const lib = vi.hoisted(() => ({ listDevices: vi.fn(), openAccountWeb: vi.fn(), signOut: vi.fn() }));
vi.mock('@hooks/use-account', () => ({ useAccount: () => account.current }));
vi.mock('@hooks/use-licence', () => ({ useLicence: () => licence.current }));
vi.mock('@lib/account', async (real) => ({ ...(await real<object>()), ...lib }));

const NOW = new Date('2026-11-07T12:00:00Z').getTime();
const IN = { kind: 'signed-in', email: 'ana@example.com', name: 'Ana Ruiz', deviceId: 'd1' };
const ROWS = [
  { id: 'd3', name: 'mini-server', lastSeenAt: '2026-11-02T12:00:00Z', createdAt: '2026-10-01T00:00:00Z', current: false },
  { id: 'd2', name: 'ana-air', lastSeenAt: '2026-11-07T10:00:00Z', createdAt: '2026-10-01T00:00:00Z', current: false },
  { id: 'd1', name: 'studio-mac', lastSeenAt: '2026-11-07T11:59:30Z', createdAt: '2026-10-01T00:00:00Z', current: true },
];

describe('AccountDevicesSection (HIVE-265)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    account.current = IN;
    licence.current = {
      kind: 'licensed',
      plan: 'team',
      features: [],
      limits: { devices: 3 },
      exp: NOW / 1000 + 9e5,
      iat: NOW / 1000,
      trialEnds: NOW / 1000 + 3 * 86_400,
    };
    lib.listDevices.mockReset().mockResolvedValue({ devices: ROWS });
    lib.openAccountWeb.mockReset().mockResolvedValue({ ok: true });
    lib.signOut.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('the account card: initial, name, "email · plan line"', async () => {
    render(<AccountDevicesSection />);
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com · Team trial · 3 days left')).toBeInTheDocument();
    expect(await screen.findByText('Devices · 3 of 3')).toBeInTheDocument();
  });

  it('with no name and no live licence: the email alone, twice', async () => {
    account.current = { ...IN, name: '' };
    licence.current = null;
    render(<AccountDevicesSection />);
    expect(screen.getAllByText('ana@example.com')).toHaveLength(2);
    expect(await screen.findByText('Devices · 3')).toBeInTheDocument();
  });

  it('devices: "Devices · 3 of 3", this Mac first and tagged, then newest first', async () => {
    render(<AccountDevicesSection />);
    expect(await screen.findByText('Devices · 3 of 3')).toBeInTheDocument();
    const names = screen.getAllByTestId('device-name').map((n) => n.textContent);
    expect(names).toEqual(['studio-mac', 'ana-air', 'mini-server']);
    expect(screen.getByText('This Mac')).toBeInTheDocument();
    expect(screen.getByText('Active now')).toBeInTheDocument();
    expect(screen.getByText('2 hr ago')).toBeInTheDocument();
    expect(screen.getByText('5 days ago')).toBeInTheDocument();
  });

  it('no device limit: "Devices · N"', async () => {
    licence.current = { ...(licence.current as object), limits: {} };
    render(<AccountDevicesSection />);
    expect(await screen.findByText('Devices · 3')).toBeInTheDocument();
  });

  it('Manage devices opens /account/devices signed in', async () => {
    render(<AccountDevicesSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Manage devices' }));
    expect(lib.openAccountWeb).toHaveBeenCalledWith('/account/devices');
  });

  it('a failed list says so in one line, and Retry asks again', async () => {
    lib.listDevices
      .mockResolvedValueOnce({ error: "Couldn't load your devices." })
      .mockResolvedValueOnce({ devices: ROWS });
    render(<AccountDevicesSection />);
    expect(await screen.findByText("Couldn't load your devices.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('studio-mac')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your devices.")).toBeNull();
  });

  it('no bridge: the list call answers null, and the group stays "Devices"', async () => {
    lib.listDevices.mockResolvedValue(null);
    render(<AccountDevicesSection />);
    await vi.waitFor(() => expect(lib.listDevices).toHaveBeenCalled());
    expect(screen.getByText('Devices')).toBeInTheDocument();
    expect(screen.queryAllByTestId('device-name')).toEqual([]);
  });

  it('Sign out confirms inline; Cancel keeps the account, confirming signs out', async () => {
    render(<AccountDevicesSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(lib.signOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    // InlineConfirm: its confirm button carries the confirmLabel
    await userEvent.click(screen.getByRole('button', { name: 'Sign out of HiveTTY Pro' }));
    expect(lib.signOut).toHaveBeenCalled();
  });

  it('signed out, or the browser target: one sentence, no list call', () => {
    account.current = null;
    render(<AccountDevicesSection />);
    expect(screen.getByText('Sign in to see your account.')).toBeInTheDocument();
    expect(lib.listDevices).not.toHaveBeenCalled();
  });
});
