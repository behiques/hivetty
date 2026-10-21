import { writeAgentSettings, writeHookSettings } from '../../hooks/settings';
import { writeMcpConfig } from '../../mcp/config';
import { writePluginDir } from '../../skills/plugin';
import type { HarnessAdapter } from '../port';

import { writeContainerSet } from './container-files';
import { launch } from './launch';

/** Adapter #1. `launch` arrived with HIVE-234, `prepare` with HIVE-235; later stories add the rest. */
export const claudeCodeAdapter: HarnessAdapter = {
  id: 'claude-code',
  capabilities: {},
  launch,
  prepare: {
    sessionSettings: writeHookSettings,
    agentSettings: writeAgentSettings,
    plugin: writePluginDir,
    containerSet: writeContainerSet,
    mcpConfig: writeMcpConfig,
  },
};
