import type { ClisConfig } from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';

/**
 * What HiveTTY runs for a CLI on this host (HIVE-376): Claude's `claudeCommand`, the others'
 * `clis.<id>.command`, else the bare name on the login shell's PATH.
 */
export const cliCommand = (id: HarnessId, clis: ClisConfig, claudeCommand: string): string =>
  id === 'claude-code' ? claudeCommand : (clis[id].command ?? id);
