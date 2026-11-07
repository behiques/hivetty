import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';

import type { AccountState, OpenWebResult, SignInResult } from '@shared/account-contract';
import { CH } from '@shared/ipc-contract';
import type { LicenceState } from '@shared/licence-contract';

import { type AccountSafeStorage, createAccountStore } from './account-store';
import { type AuthClient, createAuthClient, generateDeviceKey } from './auth-client';
import { createCloud, type Fetch, resolveCloudUrl } from './cloud';
import { schemeFor } from './deep-link';
import { abortableSleep, runDeviceFlow } from './device-flow';
import { leaseKeys } from './keys';
import { createLeaseFile, renewLease } from './lease';
import { createLicenceState, type LicenceStateMachine } from './licence-state';

/**
 * HiveTTY Pro's licence slice (HIVE-264 onwards): one module-level client, like `updates/`, so both the
 * local IPC handlers and the remote proxy answer the account calls from the same object.
 */

let client: AuthClient | null = null;
let licenceState: LicenceStateMachine | null = null;
/** Module-level, so a subscriber made before or after `startLicence` hears every change (PR 2's suspender). */
const licenceListeners = new Set<(state: LicenceState) => void>();

export function startLicence(deps: {
  app: { isPackaged: boolean; getPath(name: 'userData'): string };
  safeStorage: AccountSafeStorage;
  openExternal: (url: string) => Promise<void>;
  cloudUrl?: string;
  env: Record<string, string | undefined>;
  fetch: Fetch;
  broadcast: (state: AccountState) => void;
  /** HIVE-267: the licence's push to every window. */
  broadcastLicence: (state: LicenceState) => void;
  /** HIVE-267: the OS woke from sleep (`powerMonitor` `resume`); the lease renews. */
  onWake: (listener: () => void) => void;
}): AuthClient {
  const { app, safeStorage } = deps;
  const baseUrl = resolveCloudUrl({ isPackaged: app.isPackaged, configUrl: deps.cloudUrl, env: deps.env });
  const cloud = createCloud({ baseUrl, fetch: deps.fetch });
  const next = createAuthClient({
    cloud,
    store: createAccountStore({ safeStorage, filePath: join(app.getPath('userData'), 'account.bin') }),
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    openExternal: deps.openExternal,
    hostname,
    randomBytes,
    generateDeviceKey,
    scheme: schemeFor(app.isPackaged),
    runDeviceFlow: (input) => runDeviceFlow({ request: cloud.request, sleep: abortableSleep, now: Date.now }, input),
  });
  next.onChange(deps.broadcast);
  client = next;
  next.start();

  // HIVE-267. After `next.start()`, so the launch reads the restored account.
  licenceState?.dispose();
  const state = createLicenceState({
    account: next,
    file: createLeaseFile(join(app.getPath('userData'), 'lease.jws')),
    renew: () => renewLease((path, init) => next.authedFetch(path, init)),
    keys: leaseKeys({ isPackaged: app.isPackaged, env: deps.env }),
    iss: baseUrl,
    now: Date.now,
  });
  licenceState = state;
  state.onChange((changed) => {
    deps.broadcastLicence(changed);
    for (const listener of licenceListeners) listener(changed);
  });
  state.start();
  deps.onWake(() => void state.refresh());
  return next;
}

/** Test-only. */
export function resetLicence(): void {
  client = null;
  licenceState?.dispose();
  licenceState = null;
  licenceListeners.clear();
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
} as const;

/** What each licence call answers, for `ipc/index.ts` and `ipc/remote-proxy.ts` alike (process-local, D9). */
export const LICENCE_CALLS = {
  [CH.licenceState]: (): LicenceState => licence(),
  [CH.licenceRefresh]: (): Promise<LicenceState> => licenceState?.refresh() ?? Promise.resolve(licence()),
  [CH.licenceWatchPurchase]: (on: boolean): void => licenceState?.watchPurchase(on),
} as const;
