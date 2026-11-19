import { join } from 'node:path';

import type { Platform } from '../core/platform';

import { forkPtyHost, type HostUser } from './pty-host-fork';
import { createSecrets } from './secrets/envelope';

/**
 * The server's platform (HIVE-422): core's port, built from plain Node. Credentials are sealed with the operator's
 * key (HIVE-424), never a keychain; no screen, so no `desktop`; the PTY host is a `child_process.fork` child
 * (HIVE-423). The MCP host runs under this same Node.
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
  /** The secret key, already loaded and gone from the environment (HIVE-424). */
  key: Buffer;
}): Platform {
  const fromDir = input.fromDir ?? import.meta.dirname;
  return {
    secrets: createSecrets(input.key),
    paths: { stateDir: input.dataDir, logsDir: input.dataDir },
    resources: join(fromDir, '../../resources'),
    notify: ({ title, body }) => console.log(`[notify] ${title}: ${body}`),
    processHost: () => forkPtyHost({ entry: join(fromDir, 'pty-host.js'), user: input.hostUser }),
    mcpLaunch: { command: process.execPath, args: [join(fromDir, 'mcp-host.js')], env: {} },
    lifecycle: { version: input.version, isPackaged: input.release, quit: input.quit },
  };
}
