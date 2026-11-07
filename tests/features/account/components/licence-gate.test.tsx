import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LicenceGate } from '@features/account/components/licence-gate';
import { useUiStore } from '@stores/ui-store';

const state = vi.hoisted(() => ({ off: false as boolean | null, account: null as unknown, licence: null as unknown }));
vi.mock('@features/account/hooks/use-gate-off', () => ({ useGateOff: () => state.off }));
vi.mock('@features/account/hooks/use-code-sign-in', () => ({
  useCodeSignIn: () => ({ active: false, code: null, error: null, start: vi.fn() }),
}));
vi.mock('@hooks/use-account', () => ({ useAccount: () => state.account }));
vi.mock('@hooks/use-licence', () => ({ useLicence: () => state.licence }));
vi.mock('@features/account/components/gate', () => ({
  Gate: ({ view }: { view: { kind: string } }) => <div>gate:{view.kind}</div>,
}));

const IN = { kind: 'signed-in', email: 'a@b.c', name: 'A', deviceId: 'd' };
const LICENSED = { kind: 'licensed', plan: 'team', features: [], limits: {}, exp: 2e9, iat: 1.9e9 };
const shell = <main>workspace</main>;

beforeEach(() => {
  useUiStore.getState().reset();
  Object.assign(state, { off: false, account: null, licence: null });
});

describe('LicenceGate (HIVE-265)', () => {
  it('loading renders nothing at all', () => {
    const { container } = render(<LicenceGate>{shell}</LicenceGate>);
    expect(container).toBeEmptyDOMElement();
  });

  it('before the first licence: the gate instead of the shell', () => {
    Object.assign(state, { account: { kind: 'signed-out' }, licence: { kind: 'unlicensed' } });
    render(<LicenceGate>{shell}</LicenceGate>);
    expect(screen.getByText('gate:sign-in')).toBeInTheDocument();
    expect(screen.queryByText('workspace')).toBeNull();
    expect(useUiStore.getState().gated).toBe(false); // nothing behind it to fence
  });

  it('licensed: the shell, not inert', () => {
    Object.assign(state, { account: IN, licence: LICENSED });
    render(<LicenceGate>{shell}</LicenceGate>);
    expect(screen.getByText('workspace').closest('[inert]')).toBeNull();
  });

  it('a lapse after the first open: the gate over an inert shell that stays mounted', () => {
    Object.assign(state, { account: IN, licence: LICENSED });
    const { rerender } = render(<LicenceGate>{shell}</LicenceGate>);
    const workspace = screen.getByText('workspace');
    state.licence = { kind: 'lapsed', reason: 'trial_ended' };
    rerender(<LicenceGate>{shell}</LicenceGate>);
    expect(screen.getByText('gate:lapsed')).toBeInTheDocument();
    expect(screen.getByText('workspace')).toBe(workspace); // same node: terminals keep their buffers
    expect(workspace.closest('[inert]')).not.toBeNull();
    expect(useUiStore.getState().gated).toBe(true);
    state.licence = LICENSED;
    rerender(<LicenceGate>{shell}</LicenceGate>);
    expect(screen.queryByText(/^gate:/)).toBeNull();
    expect(useUiStore.getState().gated).toBe(false);
  });

  it('gate off: the shell at once, whatever the licence says', () => {
    Object.assign(state, { off: true, account: { kind: 'signed-out' }, licence: { kind: 'unlicensed' } });
    render(<LicenceGate>{shell}</LicenceGate>);
    expect(screen.getByText('workspace')).toBeInTheDocument();
  });

  it('gate off still unknown: nothing', () => {
    Object.assign(state, { off: null, account: IN, licence: LICENSED });
    const { container } = render(<LicenceGate>{shell}</LicenceGate>);
    expect(container).toBeEmptyDOMElement();
  });
});
