import { watch } from 'node:fs';
import { dirname, join } from 'node:path';

import { type Invocation } from '../core/cli';
import { getConfig, onConfigChange } from '../core/config';
import { configPath } from '../core/config/paths';
import { acceptRelaySocket, registerIpcHandlers, startRemoteListener } from '../core/ipc';
import {
  cloudSession,
  leaseFeatures,
  licence,
  onLicenceChange,
  runAccountCommand,
  startLicence,
} from '../core/licence';
import { entitled } from '../core/licence/entitled';
import { setPlatform } from '../core/platform';
import { startRelay } from '../core/relay';
import { bindUntilBound } from '../core/server/bind-retry';
import { claimServerLock, hiveLockPath } from '../core/server/server-lock';
import { isServerMode, setServerMode } from '../core/server-mode';
import { onShutdown } from '../core/shutdown';

import { EDITION_EXIT, EDITION_REFUSAL, gateEdition } from './edition';
import { HEARTBEAT_FILE, startHeartbeat } from './heartbeat';
import { createServerPlatform } from './platform';
import { IS_RELEASE, VERSION } from './release';
import { budgetFrom, shutDown } from './signals';

/** What the licence code asks of Electron's `app`, answered from the home folder and the build. */
const appFor = (dataDir: string) => ({
  isPackaged: IS_RELEASE,
  getPath: () => dataDir,
  getVersion: () => VERSION,
});

/**
 * Boot the server edition (HIVE-422). One function, no side effect at import, so the runner role (HIVE-300) can call
 * it with `listen: false` and dial out instead. Settings sync is not started.
 */
export function bootServer(options: { dataDir: string; listen: boolean; key: Buffer }): {
  quit(code?: number): Promise<never>;
} {
  const { dataDir } = options;
  setServerMode(true);

  // One process per hive folder, then one server per config: the desktop's two locks, in the desktop's order.
  const hiveLock = claimServerLock(hiveLockPath());
  if (hiveLock.kind === 'active') {
    console.error(
      `another HiveTTY (pid ${hiveLock.pid === null ? 'unknown' : String(hiveLock.pid)}) is using ${dirname(configPath())}. Stop it, or set HIVETTY_HOME to another folder.`,
    );
    process.exit(1);
  }
  // On `exit`, not through onShutdown: the hooks run together, and the ledger is still appending while they do.
  process.on('exit', hiveLock.release);
  const serverLock = claimServerLock();
  if (serverLock.kind === 'active') {
    console.error('cannot start: another server is already running for this config.');
    process.exit(1);
  }
  onShutdown(serverLock.release);

  let quitting: Promise<never> | null = null;
  const quit = (code = 0): Promise<never> =>
    (quitting ??= shutDown(budgetFrom(process.env)).then(() => process.exit(code)));

  const serverPlatform = createServerPlatform({
    dataDir,
    release: IS_RELEASE,
    version: VERSION,
    quit: (code) => void quit(code),
    key: options.key,
  });
  setPlatform(serverPlatform);

  startLicence({
    app: appFor(dataDir),
    safeStorage: serverPlatform.secrets,
    // No browser on a server. `--login` prints the code and the URL instead.
    openExternal: () => Promise.resolve(),
    cloudUrl: getConfig().account?.cloudUrl,
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    broadcast: () => undefined,
    broadcastLicence: () => undefined,
    onWake: () => undefined,
    // Follow account.bin written by `--login` in another process, as the desktop does.
    watch: (dir, onChange) => {
      const watcher = watch(dir, (_event, file) => onChange(file));
      watcher.on('error', () => undefined);
      return () => watcher.close();
    },
    broadcastDeviceCode: () => undefined,
  });

  const relay = startRelay({
    enabled: () => getConfig().server.relay.enabled,
    onConfigChange: (listener) => onConfigChange(() => listener()),
    serverMode: isServerMode,
    session: cloudSession,
    entitled: () => entitled('relay'),
    onLicenceChange: (listener) => onLicenceChange(() => listener()),
    accept: acceptRelaySocket,
  });
  onShutdown(() => relay.stop());

  registerIpcHandlers();

  // Before the gate: a server waiting for a licence is healthy, and a failing probe there would restart it forever.
  onShutdown(startHeartbeat(join(dataDir, HEARTBEAT_FILE)));

  if (options.listen) {
    onShutdown(
      gateEdition({
        read: licence,
        leaseFeatures,
        subscribe: onLicenceChange,
        start: () => onShutdown(bindUntilBound(startRemoteListener)),
        refuse: () => {
          console.error(EDITION_REFUSAL);
          void quit(EDITION_EXIT);
        },
      }),
    );
  }

  return { quit };
}

/** `--login` and `--logout`, through the desktop's own command, sealed with the server's key (HIVE-424). */
export function runServerAccount(
  invocation: Extract<Invocation, { kind: 'login' | 'logout' }>,
  dataDir: string,
  key: Buffer,
): Promise<number> {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const { secrets } = createServerPlatform({
    dataDir,
    release: IS_RELEASE,
    version: VERSION,
    quit: () => undefined,
    key,
  });
  return runAccountCommand(invocation, {
    app: appFor(dataDir),
    safeStorage: secrets,
    cloudUrl: getConfig().account?.cloudUrl,
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    print: (line) => console.log(line),
    signal: controller.signal,
  }).catch((cause: unknown) => {
    const verb = invocation.kind === 'login' ? 'sign in' : 'sign out';
    console.log(`could not ${verb}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  });
}
