import type { McpLaunch } from '../platform';

/**
 * The `--mcp-config` file every Hive session is launched with (HIVE-112).
 */

export interface McpConfigOptions {
  /**
   * How this shell starts `mcp-host.js` (HIVE-422): the platform's
   * `mcpLaunch`. The desktop runs its own binary as Node; a server runs Node.
   */
  launch: McpLaunch;
}

/**
 * The hive server's own descriptor, extracted so `agent-config.ts` can write
 * it into a per-agent file too (HIVE-123) — the shared `hive.mcp.json` and an
 * agent's own file must never define this server two different ways.
 */
export const hiveServerSpec = (launch: McpLaunch) => ({
  command: launch.command,
  args: launch.args,
  env: launch.env,
});
