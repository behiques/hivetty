// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRelayStatus, relayStatus, startRelay, type RelayDeps } from '../../../../electron/main/relay';
import type { RelayServeDeps } from '../../../../electron/main/relay/serve-loop';
import type { AccountState } from '../../../../electron/shared/account-contract';
import { relaySocketUrl, type RelayServeStatus } from '../../../../electron/shared/relay-contract';

const SIGNED_IN = { kind: 'signed-in' } as AccountState;
const SIGNED_OUT: AccountState = { kind: 'signed-out' };

interface Conditions {
  enabled: boolean;
  serverMode: boolean;
  account: AccountState;
  entitled: string | null;
}

function setup(overrides: Partial<RelayDeps> = {}, initial: Partial<Conditions> = {}) {
  const state: Conditions = {
    enabled: true,
    serverMode: true,
    account: SIGNED_IN,
    entitled: null,
    ...initial,
  };
  let configListener: (() => void) | null = null;
  let licenceListener: (() => void) | null = null;
  let accountListener: ((s: AccountState) => void) | null = null;
  // Real unsubscribes drop the listener, so a fire after one reaches nothing.
  const unsubConfig = vi.fn(() => {
    configListener = null;
  });
  const unsubLicence = vi.fn(() => {
    licenceListener = null;
  });
  const unsubAccount = vi.fn(() => {
    accountListener = null;
  });
  const getAccessToken = vi.fn(() => Promise.resolve('tok'));
  const session = {
    baseUrl: 'https://api.hivetty.dev',
    getAccessToken,
    account: () => state.account,
    onAccountChange: (listener: (s: AccountState) => void) => {
      accountListener = listener;
      return unsubAccount;
    },
  };
  const loop = { start: vi.fn(), stop: vi.fn() };
  let loopDeps: RelayServeDeps | null = null;
  const accept = vi.fn();
  const handle = startRelay({
    enabled: () => state.enabled,
    onConfigChange: (listener) => {
      configListener = listener;
      return unsubConfig;
    },
    serverMode: () => state.serverMode,
    session: () => session,
    entitled: () => state.entitled,
    onLicenceChange: (listener) => {
      licenceListener = listener;
      return unsubLicence;
    },
    accept,
    createServe: (deps) => {
      loopDeps = deps;
      return loop;
    },
    ...overrides,
  });
  return {
    state,
    handle,
    loop,
    accept,
    getAccessToken,
    unsubConfig,
    unsubLicence,
    unsubAccount,
    loopDeps: () => {
      if (loopDeps === null) throw new Error('no loop');
      return loopDeps;
    },
    fireConfig: () => configListener?.(),
    fireLicence: () => licenceListener?.(),
    fireAccount: () => accountListener?.(state.account),
  };
}

let current: ReturnType<typeof setup> | null = null;
const start = (overrides: Partial<RelayDeps> = {}, initial: Partial<Conditions> = {}) =>
  (current = setup(overrides, initial));

afterEach(() => {
  current?.handle.stop();
  current = null;
});

describe('startRelay', () => {
  it('runs the loop when the switch, server mode, sign-in and the entitlement all say yes', () => {
    const ctx = start();
    expect(ctx.loop.start).toHaveBeenCalledTimes(1);
    ctx.loopDeps().onStatus({ state: 'connected', since: 5 });
    expect(relayStatus()).toEqual({ state: 'connected', since: 5 });
  });

  it.each([
    ['the switch is off', { enabled: false }, { state: 'off' }],
    ['not in server mode', { serverMode: false }, { state: 'pending-launch' }],
    ['signed out', { account: SIGNED_OUT }, { state: 'sign-in' }],
    ['not entitled', { entitled: 'Relay is in Solo and above' }, { state: 'locked', reason: 'Relay is in Solo and above' }],
    ['off and signed out together', { enabled: false, account: SIGNED_OUT }, { state: 'off' }],
    ['not serving and not entitled', { serverMode: false, entitled: 'no' }, { state: 'pending-launch' }],
  ] as const)('rests when %s, and never starts the loop', (_name, initial, expected) => {
    const ctx = start({}, initial);
    expect(ctx.loop.start).not.toHaveBeenCalled();
    expect(relayStatus()).toEqual(expected);
  });

  it.each([
    ['the switch turns off', { enabled: false }, { state: 'off' }],
    ['server mode is not this boot', { serverMode: false }, { state: 'pending-launch' }],
  ] as const)('stops a running loop when %s', (_name, patch, expected) => {
    const ctx = start();
    Object.assign(ctx.state, patch);
    ctx.fireConfig();
    expect(ctx.loop.stop).toHaveBeenCalledTimes(1);
    expect(relayStatus()).toEqual(expected);
  });

  it('stops on the switch turning off and starts again on it turning on', () => {
    const ctx = start();
    ctx.state.enabled = false;
    ctx.fireConfig();
    expect(ctx.loop.stop).toHaveBeenCalledTimes(1);
    expect(relayStatus()).toEqual({ state: 'off' });
    ctx.state.enabled = true;
    ctx.fireConfig();
    expect(ctx.loop.start).toHaveBeenCalledTimes(2);
  });

  it('stops on signing out and on losing the entitlement', () => {
    const ctx = start();
    ctx.state.account = SIGNED_OUT;
    ctx.fireAccount();
    expect(ctx.loop.stop).toHaveBeenCalledTimes(1);
    expect(relayStatus()).toEqual({ state: 'sign-in' });

    ctx.state.account = SIGNED_IN;
    ctx.fireAccount();
    expect(ctx.loop.start).toHaveBeenCalledTimes(2);

    ctx.state.entitled = 'Relay is in Solo and above';
    ctx.fireLicence();
    expect(ctx.loop.stop).toHaveBeenCalledTimes(2);
    expect(relayStatus()).toEqual({ state: 'locked', reason: 'Relay is in Solo and above' });
  });

  it('holds a replaced loop until the switch goes off and on, so two installs never trade the socket', () => {
    const ctx = start();
    ctx.loopDeps().onStatus({ state: 'replaced' });
    ctx.fireConfig();
    ctx.fireLicence();
    ctx.fireAccount();
    expect(ctx.loop.start).toHaveBeenCalledTimes(1);
    expect(relayStatus()).toEqual({ state: 'replaced' });

    ctx.state.enabled = false;
    ctx.fireConfig();
    expect(relayStatus()).toEqual({ state: 'off' });
    ctx.state.enabled = true;
    ctx.fireConfig();
    expect(ctx.loop.start).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['signing out and back in', { account: SIGNED_OUT }, { account: SIGNED_IN }, { state: 'sign-in' }],
    [
      'losing and regaining the entitlement',
      { entitled: 'Relay is in Solo and above' },
      { entitled: null },
      { state: 'locked', reason: 'Relay is in Solo and above' },
    ],
  ] as const)('shows replaced again, still held, after %s', (_name, lose, regain, between) => {
    const ctx = start();
    ctx.loopDeps().onStatus({ state: 'replaced' });
    Object.assign(ctx.state, lose);
    ctx.fireAccount();
    ctx.fireLicence();
    expect(relayStatus()).toEqual(between);

    Object.assign(ctx.state, regain);
    ctx.fireAccount();
    ctx.fireLicence();
    expect(relayStatus()).toEqual({ state: 'replaced' });
    expect(ctx.loop.start).toHaveBeenCalledTimes(1);
  });

  it('publishes an unchanged resting status once', () => {
    const heard: RelayServeStatus[] = [];
    const unsubscribe = onRelayStatus((status) => heard.push(status));
    const ctx = start({}, { account: SIGNED_OUT });
    ctx.fireConfig();
    ctx.fireLicence();
    ctx.fireAccount();
    unsubscribe();
    expect(heard).toEqual([{ state: 'sign-in' }]);
  });

  it.each(['sign-in', 'locked'] as const)(
    'restarts a loop that halted itself with %s on the next change that still says run',
    (state) => {
      const ctx = start();
      ctx.loopDeps().onStatus({ state });
      expect(relayStatus()).toEqual({ state });
      expect(ctx.loop.stop).not.toHaveBeenCalled();
      ctx.fireConfig();
      expect(ctx.loop.start).toHaveBeenCalledTimes(2);
    },
  );

  it('neither starts nor stops on a change that keeps it running', () => {
    const ctx = start();
    ctx.fireConfig();
    ctx.fireLicence();
    ctx.fireAccount();
    expect(ctx.loop.start).toHaveBeenCalledTimes(1);
    expect(ctx.loop.stop).not.toHaveBeenCalled();
  });

  it('gives the loop the cloud base’s relay URL and the session’s token', async () => {
    const ctx = start();
    expect(ctx.loopDeps().url('/relay/serve')).toBe(relaySocketUrl('https://api.hivetty.dev', '/relay/serve'));
    await expect(ctx.loopDeps().token()).resolves.toBe('tok');
    expect(ctx.getAccessToken).toHaveBeenCalledTimes(1);
    expect(ctx.loopDeps().accept).toBe(ctx.accept);
  });

  it('unsubscribes, stops a running loop and rests off on stop()', () => {
    const ctx = start();
    ctx.handle.stop();
    expect(ctx.unsubConfig).toHaveBeenCalledTimes(1);
    expect(ctx.unsubLicence).toHaveBeenCalledTimes(1);
    expect(ctx.unsubAccount).toHaveBeenCalledTimes(1);
    expect(ctx.loop.stop).toHaveBeenCalledTimes(1);
    expect(relayStatus()).toEqual({ state: 'off' });
    ctx.fireConfig();
    ctx.fireLicence();
    ctx.fireAccount();
    expect(ctx.loop.start).toHaveBeenCalledTimes(1);
    current = null;
  });

  it('rests at sign-in, without throwing, before the licence has a session', async () => {
    let loopDeps: RelayServeDeps | null = null;
    const injected = { start: vi.fn(), stop: vi.fn() };
    start({
      session: () => null,
      createServe: (deps) => {
        loopDeps = deps;
        return injected;
      },
    });
    expect(relayStatus()).toEqual({ state: 'sign-in' });
    expect(injected.start).not.toHaveBeenCalled();
    const deps = loopDeps as RelayServeDeps | null;
    expect(() => deps?.url('/relay/serve')).toThrow();
    await expect(deps?.token()).resolves.toBeNull();
  });

  it('builds the real serve loop when none is injected', () => {
    const ctx = start({ createServe: undefined, enabled: () => false });
    expect(relayStatus()).toEqual({ state: 'off' });
    ctx.handle.stop();
    current = null;
  });
});

describe('onRelayStatus', () => {
  it('hears every change until it unsubscribes', () => {
    const heard: RelayServeStatus[] = [];
    const unsubscribe = onRelayStatus((status) => heard.push(status));
    const ctx = start();
    ctx.loopDeps().onStatus({ state: 'connecting' });
    unsubscribe();
    ctx.loopDeps().onStatus({ state: 'connected', since: 1 });
    expect(heard).toEqual([{ state: 'connecting' }]);
  });
});
