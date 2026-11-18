import { join } from 'node:path';

import { app, safeStorage } from 'electron';

import { createTokenStore, type StoredDeviceCredential, type TokenStore } from '../../remote-client/token-store';

/**
 * The device credential this machine was handed when it attached to someone
 * else's Hive (HIVE-144) — composed exactly as Jira's is: `safeStorage` and a
 * file under `userData`, both injected, so `token-store.ts` can be answered by
 * a unit test without a keyring.
 *
 * A function rather than a module-scope constant because `app.getPath` is only
 * answerable after the app exists, and this module is imported long before
 * that. One function rather than two construction sites because
 * `remote:pair`'s handler writes through it and {@link readRemoteCredential}
 * reads through it, and a second spelling of that filename is a credential
 * written to one path and looked for at another.
 *
 * **Exported since HIVE-153, and the rule above is why.** Both channels are on
 * `PROCESS_LOCAL`, so `router.ts` answers them from the proxy, and the local
 * handlers in core answer them through the desktop platform's
 * `remotePairing` (HIVE-422, which moved this here from `core/ipc/index.ts`:
 * remote mode is desktop-only). Every caller builds its store *through this
 * factory* rather than composing one, because the failure that rule guards
 * against is exactly the one two surfaces invite: a credential paired from the
 * local handler and looked for by the proxy at another path. There is still
 * one spelling of the filename, in one function.
 */
export function remoteCredentialStore(): TokenStore {
  return createTokenStore({
    safeStorage,
    filePath: join(app.getPath('userData'), 'remote-credential.bin'),
  });
}

/**
 * The stored device credential, or `null` when there is none this machine can
 * use (HIVE-144).
 *
 * Exported for exactly one caller: `ipc/router.ts`'s `switchIpcMode`, which
 * needs it to dial and has no business composing the store itself — Ruling 2
 * put the read on the switch rather than inside `connectRemote`, precisely so
 * the socket module stays free of Electron's `safeStorage`.
 *
 * Still not reachable from the renderer: no IPC verb returns this, and none
 * may. `remote:pair` writes the credential and `remote:forget` clears it;
 * neither hands it back.
 */
export function readRemoteCredential(): StoredDeviceCredential | null {
  return remoteCredentialStore().read();
}
