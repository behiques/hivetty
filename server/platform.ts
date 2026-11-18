import { join } from 'node:path';

import type { Platform } from '../core/platform';

import { forkPtyHost, type HostUser } from './pty-host-fork';

export const NO_SECRET_STORE = 'This server has no secret store yet (HIVE-424). Nothing is stored unencrypted.';

/**
 * The server's platform (HIVE-422): core's port, built from plain Node. No keychain, so no credential is ever
 * written; no screen, so no `desktop`; the PTY host is a `child_process.fork` child (HIVE-423). The MCP host runs under this same Node.
 */
export function createServerPlatform(input: {
  dataDir: string;
  release: boolean;
  version: string;
  quit(code?: number): void;
  /** `out/server/` when built. A parameter so a test can name the tree it means. */
  fromDir?: string;
  /** The user the PTY host runs as (HIVE-423). A runner sets it (HIVE-300); a personal server leaves it out. */
  hostUser?: HostUser;
}): Platform {
  const fromDir = input.fromDir ?? import.meta.dirname;
  const refuse = (): never => {
    throw new Error(NO_SECRET_STORE);
  };
  return {
    secrets: { isEncryptionAvailable: () => false, encryptString: refuse, decryptString: refuse },
    paths: { stateDir: input.dataDir, logsDir: input.dataDir },
    resources: join(fromDir, '../../resources'),
    notify: ({ title, body }) => console.log(`[notify] ${title}: ${body}`),
    processHost: () => forkPtyHost({ entry: join(fromDir, 'pty-host.js'), user: input.hostUser }),
    mcpLaunch: { command: process.execPath, args: [join(fromDir, 'mcp-host.js')], env: {} },
    lifecycle: { version: input.version, isPackaged: input.release, quit: input.quit },
  };
}
