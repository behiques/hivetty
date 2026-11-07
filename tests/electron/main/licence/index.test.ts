// @vitest-environment node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CH } from '../../../../electron/shared/ipc-contract';
import {
  ACCOUNT_CALLS,
  LICENCE_CALLS,
  licence,
  onLicenceChange,
  RELOAD_EVERY_MS,
  resetLicence,
  runAccountCommand,
  setPausedCensus,
  startLicence,
} from '../../../../electron/main/licence';
import { ISS, makeSigner, claimsFor } from '../../../support/lease';

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
  decryptString: (cipher: Buffer) => cipher.toString('utf8'),
};

describe('licence composition', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-licence-'));
  });
  afterEach(() => {
    resetLicence();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers signed-out and refuses sign-in before it starts', async () => {
    expect(ACCOUNT_CALLS[CH.accountState]()).toEqual({ kind: 'signed-out' });
    await expect(ACCOUNT_CALLS[CH.accountSignIn]()).resolves.toEqual({ error: expect.any(String) });
    expect(() => ACCOUNT_CALLS[CH.accountCancel]()).not.toThrow();
    await expect(ACCOUNT_CALLS[CH.accountSignOut]()).resolves.toBeUndefined();
    await expect(ACCOUNT_CALLS[CH.accountOpenWeb]('/account')).resolves.toEqual({ error: expect.any(String) });
  });

  it('opens the resolved cloud with the build scheme and broadcasts every change', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal,
      env: { HIVETTY_CLOUD_URL: 'http://127.0.0.1:4010' },
      fetch: vi.fn(),
      broadcast,
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });

    await expect(ACCOUNT_CALLS[CH.accountSignIn]()).resolves.toEqual({ ok: true });

    const url = new URL(openExternal.mock.calls[0]![0] as string);
    expect(url.origin).toBe('http://127.0.0.1:4010');
    expect(url.searchParams.get('redirect_uri')).toBe('hivetty-dev://auth/callback');
    expect(broadcast).toHaveBeenCalledWith({ kind: 'signing-in' });
    expect(ACCOUNT_CALLS[CH.accountState]()).toEqual({ kind: 'signing-in' });
    ACCOUNT_CALLS[CH.accountCancel]();
    expect(ACCOUNT_CALLS[CH.accountState]()).toEqual({ kind: 'signed-out' });
  });

  it('prefers account.cloudUrl', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    startLicence({
      app: { isPackaged: true, getPath: () => dir },
      safeStorage,
      openExternal,
      cloudUrl: 'https://hive.acme.test',
      env: {},
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });
    await ACCOUNT_CALLS[CH.accountSignIn]();
    expect(new URL(openExternal.mock.calls[0]![0] as string).origin).toBe('https://hive.acme.test');
  });

  it('answers unlicensed before it starts, and refresh is safe', async () => {
    expect(licence()).toEqual({ kind: 'unlicensed' });
    expect(LICENCE_CALLS[CH.licenceState]()).toEqual({ kind: 'unlicensed' });
    await expect(LICENCE_CALLS[CH.licenceRefresh]()).resolves.toEqual({ kind: 'unlicensed' });
    expect(() => LICENCE_CALLS[CH.licenceWatchPurchase](true)).not.toThrow();
  });

  it('starts the licence beside the account, reading <userData>/lease.jws, renewing on wake', () => {
    let wake: (() => void) | undefined;
    const broadcastLicence = vi.fn();
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: {},
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
      broadcast: vi.fn(),
      broadcastLicence,
      onWake: (listener) => {
        wake = listener;
      },
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });
    expect(licence()).toEqual({ kind: 'unlicensed' });
    expect(wake).toBeTypeOf('function');
    expect(() => wake?.()).not.toThrow();
  });

  it('a listener registered before start hears the first change, and so does the window', () => {
    const signer = makeSigner('kid-index');
    writeFileSync(join(dir, 'lease.jws'), signer.sign(claimsFor()));
    const early = vi.fn();
    onLicenceChange(early);
    const broadcastLicence = vi.fn();
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_LEASE_KEYS: JSON.stringify([signer.jwk]), HIVETTY_CLOUD_URL: ISS },
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence,
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });
    expect(early.mock.calls).toEqual([[{ kind: 'lapsed', reason: 'signed_out' }]]);
    expect(broadcastLicence).toHaveBeenCalledWith({ kind: 'lapsed', reason: 'signed_out' });
    expect(licence()).toEqual({ kind: 'lapsed', reason: 'signed_out' });
  });

  it('resetLicence forgets the listeners and the state', () => {
    const early = vi.fn();
    onLicenceChange(early);
    resetLicence();
    const signer = makeSigner('kid-reset');
    writeFileSync(join(dir, 'lease.jws'), signer.sign(claimsFor()));
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_LEASE_KEYS: JSON.stringify([signer.jwk]), HIVETTY_CLOUD_URL: ISS },
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });
    expect(early).not.toHaveBeenCalled();
    resetLicence();
    expect(licence()).toEqual({ kind: 'unlicensed' });
  });

  it('the HIVE-265 calls answer not-ready before startLicence', async () => {
    await expect(ACCOUNT_CALLS[CH.accountDevices]()).resolves.toEqual({ error: 'Sign-in is not ready yet. Try again in a moment.' });
    await expect(LICENCE_CALLS[CH.licenceStartTrial]()).resolves.toEqual({ error: 'Sign-in is not ready yet. Try again in a moment.' });
  });

  it('licence:paused is empty unless lapsed, and reads the census at call time', () => {
    const census = vi.fn(() => ({ sessions: ['api'], agents: ['shipper'] }));
    setPausedCensus(census);
    expect(LICENCE_CALLS[CH.licencePaused]()).toEqual({ sessions: [], agents: [] }); // unlicensed
    expect(census).not.toHaveBeenCalled();
  });

  it('licence:paused names the census while lapsed, and resetLicence forgets it', () => {
    const signer = makeSigner('kid-paused');
    writeFileSync(join(dir, 'lease.jws'), signer.sign(claimsFor()));
    setPausedCensus(() => ({ sessions: ['api'], agents: ['shipper'] }));
    const boot = {
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_LEASE_KEYS: JSON.stringify([signer.jwk]), HIVETTY_CLOUD_URL: ISS },
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    };
    startLicence(boot);
    expect(licence()).toEqual({ kind: 'lapsed', reason: 'signed_out' });
    expect(LICENCE_CALLS[CH.licencePaused]()).toEqual({ sessions: ['api'], agents: ['shipper'] });
    resetLicence();
    startLicence(boot);
    expect(licence()).toEqual({ kind: 'lapsed', reason: 'signed_out' });
    expect(LICENCE_CALLS[CH.licencePaused]()).toEqual({ sessions: [], agents: [] });
  });

  it('account:devices and licence:start-trial run through the started client', async () => {
    const signer = makeSigner('kid-calls');
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_LEASE_KEYS: JSON.stringify([signer.jwk]), HIVETTY_CLOUD_URL: ISS },
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });
    // Signed out: authedFetch has no account, so each answers its own error rather than not-ready.
    await expect(ACCOUNT_CALLS[CH.accountDevices]()).resolves.toEqual({ error: "Couldn't reach HiveTTY. Try again." });
    await expect(LICENCE_CALLS[CH.licenceStartTrial]()).resolves.toEqual({ error: "Couldn't reach HiveTTY. Try again." });
  });
});

describe('the running instance follows account.bin (HIVE-266)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-licence-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    resetLicence();
    rmSync(dir, { recursive: true, force: true });
  });

  const boot = (watch = vi.fn((_dir: string, _on: (file: string | null) => void) => () => undefined)) =>
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_CLOUD_URL: ISS },
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch,
      broadcastDeviceCode: vi.fn(),
    });
  const ACCOUNT = {
    refreshToken: 'rt-1',
    deviceId: 'dev-1',
    deviceKey: { publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'p' }, privateJwk: { kty: 'OKP', crv: 'Ed25519', x: 'p', d: 'q' } },
    email: 'ana@example.com',
    name: 'Ana',
  };

  it('watches the folder and reloads on account.bin (or an unnamed event), not on the temp file', () => {
    let fire: (file: string | null) => void = () => undefined;
    const watch = vi.fn((_dir: string, on: (file: string | null) => void) => {
      fire = on;
      return () => undefined;
    });
    boot(watch);
    expect(watch).toHaveBeenCalledWith(dir, expect.any(Function));
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    fire('account.bin.tmp');
    expect(ACCOUNT_CALLS[CH.accountState]()).toEqual({ kind: 'signed-out' });
    fire('account.bin');
    expect(ACCOUNT_CALLS[CH.accountState]()).toMatchObject({ kind: 'signed-in', email: 'ana@example.com' });
    rmSync(join(dir, 'account.bin'));
    fire(null);
    expect(ACCOUNT_CALLS[CH.accountState]()).toMatchObject({ kind: 'signed-out' });
  });

  it('reloads every 30 s even with no watch event', async () => {
    vi.useFakeTimers();
    boot();
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    await vi.advanceTimersByTimeAsync(RELOAD_EVERY_MS);
    expect(ACCOUNT_CALLS[CH.accountState]()).toMatchObject({ kind: 'signed-in' });
  });

  it('a watch that throws (folder missing) leaves the 30 s reload to cover it', () => {
    expect(() => boot(vi.fn(() => {
      throw new Error('ENOENT');
    }))).not.toThrow();
  });

  it('resetLicence stops watching and reloading', () => {
    const stop = vi.fn();
    boot(vi.fn(() => stop));
    resetLicence();
    expect(stop).toHaveBeenCalled();
  });
});

describe('runAccountCommand (HIVE-266)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-licence-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (invocation: Parameters<typeof runAccountCommand>[0], over: { encryptThrows?: boolean } = {}) => {
    const lines: string[] = [];
    const code = runAccountCommand(invocation, {
      app: { isPackaged: false, getPath: () => dir },
      safeStorage: {
        ...safeStorage,
        encryptString: (plain: string) => {
          if (over.encryptThrows) throw new Error('keychain locked');
          return safeStorage.encryptString(plain);
        },
      },
      env: { HIVETTY_CLOUD_URL: ISS },
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
      print: (line) => lines.push(line),
      signal: new AbortController().signal,
    });
    return { code, lines };
  };

  it('--login exits 3 when a trial encrypt throws, and writes nothing', async () => {
    const { code } = run({ kind: 'login', force: false }, { encryptThrows: true });
    await expect(code).resolves.toBe(3);
    expect(existsSync(join(dir, 'account.bin'))).toBe(false);
  });

  it('--login against an unreachable cloud exits 2', async () => {
    await expect(run({ kind: 'login', force: false }).code).resolves.toBe(2);
  });

  it('--logout with nothing stored exits 0', async () => {
    const { code, lines } = run({ kind: 'logout' });
    await expect(code).resolves.toBe(0);
    expect(lines).toEqual(['Not signed in.']);
  });
});

describe('account:sign-in-code (HIVE-266)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-licence-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    resetLicence();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers not-ready before start', async () => {
    await expect(ACCOUNT_CALLS[CH.accountSignInCode]()).resolves.toEqual({ error: expect.any(String) });
  });

  it('pushes the code to every window and resolves when the flow ends', async () => {
    const broadcastDeviceCode = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/device/code')
        ? new Response(
            JSON.stringify({
              device_code: 'd',
              user_code: 'WDJB-MJHT',
              verification_uri: `${ISS}/device`,
              expires_in: 600,
              interval: 5,
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ error: 'access_denied' }), { status: 400 }),
    );
    vi.useFakeTimers();
    startLicence({
      app: { isPackaged: false, getPath: () => dir },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_CLOUD_URL: ISS },
      fetch,
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode,
    });
    const done = ACCOUNT_CALLS[CH.accountSignInCode]();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(done).resolves.toMatchObject({ error: expect.any(String) });
    expect(broadcastDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'WDJB-MJHT' }));
  });
});
