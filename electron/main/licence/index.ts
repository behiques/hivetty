import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';

import type { AccountState, SignInResult } from '@shared/account-contract';
import { CH } from '@shared/ipc-contract';

import { type AccountSafeStorage, createAccountStore } from './account-store';
import { type AuthClient, createAuthClient, generateDeviceKey } from './auth-client';
import { createCloud, type Fetch, resolveCloudUrl } from './cloud';
import { schemeFor } from './deep-link';

/**
 * HiveTTY Pro's licence slice (HIVE-264 onwards): one module-level client, like `updates/`, so both the
 * local IPC handlers and the remote proxy answer the account calls from the same object.
 */

let client: AuthClient | null = null;

export function startLicence(deps: {
  app: { isPackaged: boolean; getPath(name: 'userData'): string };
  safeStorage: AccountSafeStorage;
  openExternal: (url: string) => Promise<void>;
  cloudUrl?: string;
  env: Record<string, string | undefined>;
  fetch: Fetch;
  broadcast: (state: AccountState) => void;
}): AuthClient {
  const { app, safeStorage } = deps;
  const next = createAuthClient({
    cloud: createCloud({
      baseUrl: resolveCloudUrl({ isPackaged: app.isPackaged, configUrl: deps.cloudUrl, env: deps.env }),
      fetch: deps.fetch,
    }),
    store: createAccountStore({ safeStorage, filePath: join(app.getPath('userData'), 'account.bin') }),
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    openExternal: deps.openExternal,
    hostname,
    randomBytes,
    generateDeviceKey,
    scheme: schemeFor(app.isPackaged),
  });
  next.onChange(deps.broadcast);
  client = next;
  next.start();
  return next;
}

/** Test-only. */
export function resetLicence(): void {
  client = null;
}

const NOT_READY = 'Sign-in is not ready yet. Try again in a moment.';

/** What each account call answers, for `ipc/index.ts` and `ipc/remote-proxy.ts` alike. */
export const ACCOUNT_CALLS = {
  [CH.accountState]: (): AccountState => client?.state() ?? { kind: 'signed-out' },
  [CH.accountSignIn]: (): Promise<SignInResult> => client?.signIn() ?? Promise.resolve({ error: NOT_READY }),
  [CH.accountCancel]: (): void => client?.cancel(),
  [CH.accountSignOut]: (): Promise<void> => client?.signOut() ?? Promise.resolve(),
} as const;
