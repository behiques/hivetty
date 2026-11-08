import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

import type {
  AccountState,
  DeviceCode,
  DevicesResult,
  OpenWebResult,
  SignInResult,
  TrialResult,
} from '@shared/account-contract';
import { CH } from '@shared/ipc-contract';
import type { HostLicence, LicenceState, Paused } from '@shared/licence-contract';

import { runLogin, runLogout } from './account-command';
import { type AccountSafeStorage, createAccountStore } from './account-store';
import { type AuthClient, createAuthClient, generateDeviceKey } from './auth-client';
import { createCloud, type Fetch, resolveCloudUrl } from './cloud';
import { schemeFor } from './deep-link';
import { abortableSleep, runDeviceFlow } from './device-flow';
import { listDevices } from './devices';
import { leaseKeys } from './keys';
import { createLeaseFile, renewLease } from './lease';
import { createLicenceState, type LicenceStateMachine } from './licence-state';
import { startTrial } from './trial';

/**
 * HiveTTY Pro's licence slice (HIVE-264 onwards): one module-level client, like `updates/`, so both the
 * local IPC handlers and the remote proxy answer the account calls from the same object.
 */

let client: AuthClient | null = null;
let licenceState: LicenceStateMachine | null = null;
/** Module-level, so a subscriber made before or after `startLicence` hears every change (PR 2's suspender). */
const licenceListeners = new Set<(state: LicenceState) => void>();

export const ACCOUNT_FILE = 'account.bin';
/** HIVE-266: how often a running instance re-reads account.bin, in case a watch event was missed. */
export const RELOAD_EVERY_MS = 30_000;

interface AccountBoot {
  app: { isPackaged: boolean; getPath(name: 'userData'): string };
  safeStorage: AccountSafeStorage;
  cloudUrl?: string;
  env: Record<string, string | undefined>;
  fetch: Fetch;
}

/** The cloud, the store and the client, built the same way for the app and for a one-shot (HIVE-266). */
function buildAccount(deps: AccountBoot & { openExternal: (url: string) => Promise<void> }) {
  const { app, safeStorage } = deps;
  const baseUrl = resolveCloudUrl({ isPackaged: app.isPackaged, configUrl: deps.cloudUrl, env: deps.env });
  const cloud = createCloud({ baseUrl, fetch: deps.fetch });
  const userData = app.getPath('userData');
  const accountPath = join(userData, ACCOUNT_FILE);
  const store = createAccountStore({ safeStorage, filePath: accountPath });
  const built = createAuthClient({
    cloud,
    store,
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    openExternal: deps.openExternal,
    hostname,
    randomBytes,
    generateDeviceKey,
    scheme: schemeFor(app.isPackaged),
    runDeviceFlow: (input) => runDeviceFlow({ request: cloud.request, sleep: abortableSleep, now: Date.now }, input),
  });
  return {
    baseUrl,
    store,
    client: built,
    accountPath,
    leaseFile: createLeaseFile(join(userData, 'lease.jws')),
    keys: leaseKeys({ isPackaged: app.isPackaged, env: deps.env }),
  };
}

/** HIVE-266: stops the account.bin watch and the 30 s reload. */
let stopFollowing: (() => void) | null = null;
/** HIVE-266: the device-flow code's push to every window. */
let pushDeviceCode: (code: DeviceCode) => void = () => undefined;

const NOTHING_PAUSED: Paused = { sessions: [], agents: [] };
let census: () => Paused = () => NOTHING_PAUSED;

/** HIVE-265: what `licence:paused` names, read at call time. `ipc/index.ts` installs it beside the suspender. */
export function setPausedCensus(read: () => Paused): void {
  census = read;
}

export function startLicence(
  deps: AccountBoot & {
    openExternal: (url: string) => Promise<void>;
    broadcast: (state: AccountState) => void;
    /** HIVE-267: the licence's push to every window. */
    broadcastLicence: (state: LicenceState) => void;
    /** HIVE-267: the OS woke from sleep (`powerMonitor` `resume`); the lease renews. */
    onWake: (listener: () => void) => void;
    /** HIVE-266: watch a folder; `file` is the changed name, or null when the OS does not say. Returns a disposer. */
    watch: (dir: string, onChange: (file: string | null) => void) => () => void;
    /** HIVE-266: the `account:device-code` push to every window. */
    broadcastDeviceCode: (code: DeviceCode) => void;
  },
): AuthClient {
  const built = buildAccount(deps);
  const next = built.client;
  next.onChange(deps.broadcast);
  client = next;
  next.start();

  // HIVE-267. After `next.start()`, so the launch reads the restored account.
  licenceState?.dispose();
  const state = createLicenceState({
    account: next,
    file: built.leaseFile,
    // HIVE-291: every renewal (launch, 24 h, wake, sign-in, refresh, a switch) asks for the stored org.
    renew: () => renewLease((path, init) => next.authedFetch(path, init), built.store.read()?.activeOrg),
    keys: built.keys,
    iss: built.baseUrl,
    now: Date.now,
  });
  licenceState = state;
  state.onChange((changed) => {
    deps.broadcastLicence(changed);
    for (const listener of licenceListeners) listener(changed);
  });
  state.start();
  deps.onWake(() => void state.refresh());

  // HIVE-266. `hivetty --login`/`--logout` in another process write account.bin; follow it with no restart.
  stopFollowing?.();
  let stopWatch: () => void = () => undefined;
  try {
    stopWatch = deps.watch(dirname(built.accountPath), (file) => {
      // A rename lands as the final name; macOS may report no name at all.
      if (file === null || file === ACCOUNT_FILE) next.reload();
    });
  } catch {
    // No folder to watch yet: the interval below still notices.
  }
  const reloadTimer = setInterval(() => next.reload(), RELOAD_EVERY_MS);
  stopFollowing = () => {
    stopWatch();
    clearInterval(reloadTimer);
  };
  pushDeviceCode = deps.broadcastDeviceCode;
  return next;
}

/** Test-only. */
export function resetLicence(): void {
  client = null;
  licenceState?.dispose();
  licenceState = null;
  licenceListeners.clear();
  stopFollowing?.();
  stopFollowing = null;
  pushDeviceCode = () => undefined;
  census = () => NOTHING_PAUSED;
}

/** Main's one read of the licence (HIVE-267; HIVE-268's single licence read). */
export function licence(): LicenceState {
  return licenceState?.state() ?? { kind: 'unlicensed' };
}

export function onLicenceChange(listener: (state: LicenceState) => void): () => void {
  licenceListeners.add(listener);
  return () => licenceListeners.delete(listener);
}

const NOT_READY = 'Sign-in is not ready yet. Try again in a moment.';

/** What each account call answers, for `ipc/index.ts` and `ipc/remote-proxy.ts` alike. */
export const ACCOUNT_CALLS = {
  [CH.accountState]: (): AccountState => client?.state() ?? { kind: 'signed-out' },
  [CH.accountSignIn]: (): Promise<SignInResult> => client?.signIn() ?? Promise.resolve({ error: NOT_READY }),
  [CH.accountCancel]: (): void => client?.cancel(),
  [CH.accountSignOut]: (): Promise<void> => client?.signOut() ?? Promise.resolve(),
  [CH.accountOpenWeb]: (path: unknown): Promise<OpenWebResult> =>
    client?.openWeb(path) ?? Promise.resolve({ error: NOT_READY }),
  /** HIVE-266: sign in with a code; the code goes to every window on account:device-code. */
  [CH.accountSignInCode]: (): Promise<SignInResult> =>
    client?.signInWithCode({ onCode: (code) => pushDeviceCode(code) }) ?? Promise.resolve({ error: NOT_READY }),
  /** HIVE-265: this account's live devices, from the cloud. */
  [CH.accountDevices]: (): Promise<DevicesResult> =>
    client ? listDevices(client.authedFetch) : Promise.resolve({ error: NOT_READY }),
} as const;

/** What each licence call answers, for `ipc/index.ts` and `ipc/remote-proxy.ts` alike (process-local, D9). */
export const LICENCE_CALLS = {
  [CH.licenceState]: (): LicenceState => licence(),
  [CH.licenceRefresh]: (): Promise<LicenceState> => licenceState?.refresh() ?? Promise.resolve(licence()),
  [CH.licenceWatchPurchase]: (on: boolean): void => licenceState?.watchPurchase(on),
  [CH.licenceStartTrial]: (): Promise<TrialResult> => {
    const account = client;
    const state = licenceState;
    if (!account || !state) return Promise.resolve({ error: NOT_READY });
    return startTrial({ authedFetch: account.authedFetch, refresh: () => state.refresh(), signOut: () => account.signOut() });
  },
  // Read at call time: while lapsed every live thing is paused and nothing new can start.
  [CH.licencePaused]: (): Paused => (licence().kind === 'lapsed' ? census() : NOTHING_PAUSED),
} as const;

/** This machine's licence as a server reports it to attached clients (HIVE-265): counts, never names. */
export function hostLicence(): HostLicence {
  const { sessions, agents } = LICENCE_CALLS[CH.licencePaused]();
  return { lapsed: licence().kind === 'lapsed', paused: { sessions: sessions.length, agents: agents.length } };
}

export type AccountCommandBoot = AccountBoot & { print: (line: string) => void; signal: AbortSignal };

/** `hivetty --login` / `--logout` (HIVE-266), after `whenReady`. Returns the exit code. */
export function runAccountCommand(
  invocation: { kind: 'login'; force: boolean } | { kind: 'logout' },
  boot: AccountCommandBoot,
): Promise<number> {
  const built = buildAccount({ ...boot, openExternal: () => Promise.reject(new Error('no browser in a one-shot')) });
  const deps = {
    client: built.client,
    store: built.store,
    canEncrypt: () => {
      if (!boot.safeStorage.isEncryptionAvailable()) return false;
      try {
        boot.safeStorage.encryptString('hivetty-probe');
        return true;
      } catch {
        return false;
      }
    },
    lease: built.leaseFile,
    keys: built.keys,
    iss: built.baseUrl,
    now: Date.now,
    hostname,
    print: boot.print,
    signal: boot.signal,
  };
  return invocation.kind === 'login' ? runLogin({ force: invocation.force }, deps) : runLogout(deps);
}
