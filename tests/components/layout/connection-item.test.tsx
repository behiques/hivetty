import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteLinkStatus } from '@shared/ipc-contract';

import { ConnectionItem } from '@components/layout/connection-item';
import { useUiStore } from '@stores/ui-store';

const src = vi.hoisted(() => ({
  desktop: true,
  exposed: null as string | null,
  serving: null as string | null,
  devices: 0,
  link: null as RemoteLinkStatus | null,
}));

vi.mock('@config/runtime', () => ({ isDesktop: () => src.desktop }));
vi.mock('@hooks/use-project-config', () => ({
  useReceiverExposure: () => src.exposed,
  useServerExposure: () => src.serving,
  useServingDeviceCount: () => src.devices,
}));
vi.mock('@stores/hive-store', () => ({ useRemoteLink: () => src.link }));

const link = (over: Partial<RemoteLinkStatus> = {}): RemoteLinkStatus => ({
  state: 'attached',
  serverName: 'mac-mini',
  attempt: 0,
  nextAttemptAt: null,
  reason: null,
  epoch: 0,
  lost: 0,
  ...over,
});

const item = () => screen.getByTestId('connection-item');
const open = async () => {
  await userEvent.click(item());
  return screen.getByRole('dialog');
};

describe('ConnectionItem (HIVE-196)', () => {
  beforeEach(() => {
    Object.assign(src, { desktop: true, exposed: null, serving: null, devices: 0, link: null });
    useUiStore.getState().reset();
  });

  it.each([
    ['local', {}, 'Local', 'text-muted', 'bg-green'],
    ['serving', { serving: '0.0.0.0:7420', devices: 2 }, 'Serving', 'text-muted', 'bg-brand'],
    ['attached', { link: link() }, 'mac-mini', 'text-muted', 'bg-brand'],
    ['reconnecting', { link: link({ state: 'reconnecting' }) }, 'mac-mini', 'text-amber', 'border-amber'],
    ['disconnected', { link: link({ state: 'disconnected' }) }, 'mac-mini', 'text-muted', 'bg-red'],
    ['exposed', { exposed: '0.0.0.0' }, 'Exposed', 'text-amber', 'bg-amber'],
    ['demo', { desktop: false }, 'Demo', 'text-amber', 'bg-amber'],
  ] as const)('%s: label, tone and dot', (_state, over, label, tone, dot) => {
    Object.assign(src, over);
    render(<ConnectionItem />);
    expect(item()).toHaveTextContent(label);
    expect(item()).toHaveAccessibleName(`Connection: ${label}`);
    expect(item()).toHaveClass(tone);
    expect(item().querySelector('[data-dot]')).toHaveClass(dot);
  });

  it('pulses the reconnecting ring', () => {
    src.link = link({ state: 'reconnecting' });
    render(<ConnectionItem />);
    expect(item().querySelector('[data-dot]')).toHaveClass('animate-ccpulse');
  });

  it('labels by precedence and lists every state that holds', async () => {
    Object.assign(src, { exposed: '0.0.0.0', link: link() });
    render(<ConnectionItem />);
    expect(item()).toHaveTextContent('Exposed');

    const dialog = await open();
    const titles = within(dialog).getAllByRole('heading').map((h) => h.textContent);
    expect(titles).toEqual(['Exposed on 0.0.0.0', 'Attached to mac-mini']);
  });

  it('local says nothing is served or exposed', async () => {
    render(<ConnectionItem />);
    expect(await open()).toHaveTextContent('This Hive runs here. Nothing is served or exposed.');
  });

  it('serving names the devices and the address, and links to Server mode', async () => {
    Object.assign(src, { serving: '0.0.0.0:7420', devices: 1 });
    render(<ConnectionItem />);
    const dialog = await open();
    expect(dialog).toHaveTextContent('Serving its sessions to 1 paired device on 0.0.0.0:7420.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Settings › Advanced › Server mode' }));

    expect(useUiStore.getState()).toMatchObject({ settings: true, settingsSection: 'advanced' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposed names the address and links to Containers', async () => {
    src.exposed = '0.0.0.0';
    render(<ConnectionItem />);
    const dialog = await open();
    expect(dialog).toHaveTextContent('The receiver accepts connections on 0.0.0.0, not only loopback.');
    expect(within(dialog).getByRole('button', { name: 'Settings › Advanced › Containers' })).toBeInTheDocument();
  });

  it('attached, disconnected and demo carry their sentences', async () => {
    src.link = link();
    const { unmount } = render(<ConnectionItem />);
    expect(await open()).toHaveTextContent('its sessions are what you are driving right now');
    unmount();

    src.link = link({ state: 'disconnected', reason: 'token revoked' });
    const second = render(<ConnectionItem />);
    expect(await open()).toHaveTextContent('The connection ended and is not being retried: token revoked');
    second.unmount();

    src.link = null;
    src.desktop = false;
    render(<ConnectionItem />);
    expect(await open()).toHaveTextContent('Real sessions need the desktop app.');
  });

  it('never renders a header', () => {
    render(<ConnectionItem />);
    expect(screen.queryByRole('banner')).toBeNull();
  });
});
