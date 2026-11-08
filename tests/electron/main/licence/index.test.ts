// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  hostLicence,
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
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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

  it('sends a packaged release candidate to the dev cloud, returning on the packaged scheme', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    startLicence({
      app: { isPackaged: true, getPath: () => dir, getVersion: () => '1.0.0-rc.1' },
      safeStorage,
      openExternal,
      env: {},
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });
    await ACCOUNT_CALLS[CH.accountSignIn]();
    const url = new URL(openExternal.mock.calls[0]![0] as string);
    expect(url.origin).toBe('https://api.dev.hivetty.dev');
    expect(url.searchParams.get('redirect_uri')).toBe('hivetty://auth/callback');
  });

  it('sends a packaged stable release to the prod cloud', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    startLicence({
      app: { isPackaged: true, getPath: () => dir, getVersion: () => '1.0.0' },
      safeStorage,
      openExternal,
      env: {},
      fetch: vi.fn(),
      broadcast: vi.fn(),
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });
    await ACCOUNT_CALLS[CH.accountSignIn]();
    expect(new URL(openExternal.mock.calls[0]![0] as string).origin).toBe('https://api.hivetty.dev');
  });

  it('prefers account.cloudUrl', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    startLicence({
      app: { isPackaged: true, getPath: () => dir, getVersion: () => '1.0.0' },
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
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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

  it('hostLicence is not lapsed and counts nothing before start (HIVE-265)', () => {
    setPausedCensus(() => ({ sessions: ['api', 'web'], agents: ['shipper'] }));
    expect(hostLicence()).toEqual({ lapsed: false, paused: { sessions: 0, agents: 0 } });
  });

  it('hostLicence reports a lapse with the census counted, never named (HIVE-265)', () => {
    const signer = makeSigner('kid-host');
    writeFileSync(join(dir, 'lease.jws'), signer.sign(claimsFor()));
    setPausedCensus(() => ({ sessions: ['api', 'web'], agents: ['shipper'] }));
    startLicence({
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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
    expect(licence()).toEqual({ kind: 'lapsed', reason: 'signed_out' });
    expect(hostLicence()).toEqual({ lapsed: true, paused: { sessions: 2, agents: 1 } });
  });

  it('account:devices and licence:start-trial run through the started client', async () => {
    const signer = makeSigner('kid-calls');
    startLicence({
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
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
describe('the renewal asks for the stored org (HIVE-291)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-licence-'));
  });
  afterEach(() => {
    resetLicence();
    rmSync(dir, { recursive: true, force: true });
  });

  const ACCOUNT = {
    refreshToken: 'rt-1',
    deviceId: 'dev-1',
    deviceKey: { publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'p' }, privateJwk: { kty: 'OKP', crv: 'Ed25519', x: 'p', d: 'q' } },
    email: 'ana@example.com',
    name: 'Ana',
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const TOKEN = {
    access_token: 'at-2',
    refresh_token: 'rt-2',
    expires_in: 3600,
    device_id: 'dev-1',
    user: { email: 'ana@example.com', name: 'Ana' },
  };
  const ORG_A = { id: 'org-a', name: 'A', role: 'Owner', seat: true, plan: 'solo', status: 'active', personal: true };
  const ORG_B = { id: 'org-b', name: 'B', role: 'Member', seat: true, plan: 'team', status: 'active', personal: false };
  let rows: unknown[] = [ORG_A];
  /** The cloud: a token for any refresh, `rows` on GET /api/orgs, and a refused lease (its body is under test). */
  const cloud = () =>
    vi.fn((url: string, _init?: RequestInit) =>
      Promise.resolve(
        url.endsWith('/api/oauth/token')
          ? json(200, TOKEN)
          : url.endsWith('/api/orgs')
            ? json(200, { orgs: rows })
            : json(403, { error: 'lease_refused', reason: 'no_plan' }),
      ),
    );
  const leaseBodies = (fetch: ReturnType<typeof cloud>) =>
    fetch.mock.calls.filter(([url]) => url === `${ISS}/api/lease`).map(([, init]) => init?.body);
  const boot = (fetch: ReturnType<typeof cloud>, broadcast = vi.fn()) =>
    startLicence({
      app: { isPackaged: false, getPath: () => dir, getVersion: () => '1.0.0' },
      safeStorage,
      openExternal: vi.fn(),
      env: { HIVETTY_CLOUD_URL: ISS },
      fetch,
      broadcast,
      broadcastLicence: vi.fn(),
      onWake: vi.fn(),
      watch: vi.fn(() => () => undefined),
      broadcastDeviceCode: vi.fn(),
    });

  it('posts the stored activeOrg, and the token rotation keeps it in account.bin', async () => {
    writeFileSync(join(dir, 'account.bin'), JSON.stringify({ ...ACCOUNT, activeOrg: 'org-b' }));
    const fetch = cloud();
    boot(fetch);
    await LICENCE_CALLS[CH.licenceRefresh]();
    expect(leaseBodies(fetch).length).toBeGreaterThan(0);
    expect(leaseBodies(fetch).every((body) => body === '{"org":"org-b"}')).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'account.bin'), 'utf8'))).toMatchObject({
      refreshToken: 'rt-2',
      activeOrg: 'org-b',
    });
  });

  it('posts no body when none is stored', async () => {
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    const fetch = cloud();
    boot(fetch);
    await LICENCE_CALLS[CH.licenceRefresh]();
    expect(leaseBodies(fetch).length).toBeGreaterThan(0);
    expect(leaseBodies(fetch).every((body) => body === undefined)).toBe(true);
  });

  it('account:orgs answers [] and account:switch-org the licence before startLicence', async () => {
    await expect(ACCOUNT_CALLS[CH.accountOrgs]()).resolves.toEqual([]);
    await expect(ACCOUNT_CALLS[CH.accountSwitchOrg]('org-b')).resolves.toEqual({ kind: 'unlicensed' });
    await expect(ACCOUNT_CALLS[CH.accountBilling]('org-b')).resolves.toBeNull();
  });

  it('account:switch-org writes activeOrg, broadcasts it, and renews asking for it', async () => {
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    const fetch = cloud();
    const broadcast = vi.fn();
    boot(fetch, broadcast);
    await LICENCE_CALLS[CH.licenceRefresh]();
    const before = leaseBodies(fetch).length;
    await expect(ACCOUNT_CALLS[CH.accountSwitchOrg]('org-b')).resolves.toEqual({ kind: 'lapsed', reason: 'no_plan' });
    expect(leaseBodies(fetch).slice(before).at(-1)).toBe('{"org":"org-b"}');
    expect(JSON.parse(readFileSync(join(dir, 'account.bin'), 'utf8'))).toMatchObject({ activeOrg: 'org-b' });
    expect(broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'signed-in', activeOrg: 'org-b' }));
  });

  it('account:switch-org made during a renewal still ends on a lease asked for the new org', async () => {
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    const fetch = cloud();
    boot(fetch);
    const inFlight = LICENCE_CALLS[CH.licenceRefresh](); // starts before activeOrg exists, so it asks for no org
    await ACCOUNT_CALLS[CH.accountSwitchOrg]('org-b');
    await inFlight;
    expect(leaseBodies(fetch).at(-1)).toBe('{"org":"org-b"}');
  });

  it('account:switch-org refuses an id that is not 1–64 characters, renewing nothing', async () => {
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    const fetch = cloud();
    boot(fetch);
    await LICENCE_CALLS[CH.licenceRefresh]();
    const before = leaseBodies(fetch).length;
    for (const id of ['', 'x'.repeat(65), 5, null]) {
      await expect(ACCOUNT_CALLS[CH.accountSwitchOrg](id)).resolves.toEqual({ kind: 'lapsed', reason: 'no_plan' });
    }
    expect(leaseBodies(fetch).length).toBe(before);
    expect(JSON.parse(readFileSync(join(dir, 'account.bin'), 'utf8'))).not.toHaveProperty('activeOrg');
  });

  it('account:orgs seeds on its first list and renews when a later list holds a new org (D5)', async () => {
    rows = [ORG_A];
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    const fetch = cloud();
    boot(fetch);
    await LICENCE_CALLS[CH.licenceRefresh]();
    const before = leaseBodies(fetch).length;
    await expect(ACCOUNT_CALLS[CH.accountOrgs]()).resolves.toEqual([ORG_A]);
    await ACCOUNT_CALLS[CH.accountOrgs]();
    expect(leaseBodies(fetch).length).toBe(before);
    rows = [ORG_A, ORG_B];
    await expect(ACCOUNT_CALLS[CH.accountOrgs]()).resolves.toEqual([ORG_A, ORG_B]);
    // No refresh of our own: only the seen-set's renewal can make this request.
    await vi.waitFor(() => expect(leaseBodies(fetch).length).toBe(before + 1));
  });

  it('sign-out clears the seen-set, so the next account\'s first list seeds rather than renews (D5)', async () => {
    rows = [ORG_A];
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    const fetch = cloud();
    const account = boot(fetch);
    await LICENCE_CALLS[CH.licenceRefresh]();
    await ACCOUNT_CALLS[CH.accountOrgs]();
    await ACCOUNT_CALLS[CH.accountSignOut]();
    writeFileSync(join(dir, 'account.bin'), JSON.stringify(ACCOUNT));
    account.reload();
    await LICENCE_CALLS[CH.licenceRefresh]();
    const before = leaseBodies(fetch).length;
    rows = [ORG_B];
    await expect(ACCOUNT_CALLS[CH.accountOrgs]()).resolves.toEqual([ORG_B]);
    // A macrotask turn drains every microtask a renewal would have queued (the fetch mock resolves at once).
    await new Promise((resolve) => setImmediate(resolve));
    expect(leaseBodies(fetch).length).toBe(before);
  });
});
