import { claudeCodeAdapter } from '../claude-code';
import type { HarnessAdapter, PermissionFence } from '../port';

import { copilotFenceReply, readCopilotFence, translateCopilotCall } from './fence';
import { launchCopilotHeadless } from './headless';
import { readCopilotHeadless } from './headless-reader';
import { readCopilotHook } from './hooks';
import { launchCopilotSession } from './launch';
import { copilotRecord } from './record';

/* A Copilot session's hooks plugin is its launch's own `files` (`./launch`); nothing shared is written. */
const noSettings = (): Promise<string> => Promise.resolve('');
const noFile = (): Promise<void> => Promise.resolve();

const noMarkers = (): never => {
  throw new Error('copilot sessions take no prompt markers yet.');
};

/**
 * Total (HIVE-343): every rule is enforced by `decide` on the translated call, through the
 * `preToolUse` hook in the home's `settings.json` and the receiver's `/fence`. Copilot's own layer
 * allows only the kinds (`--allow-tool shell|write|hive`); `--deny-tool` wins over both.
 */
export const copilotFence: PermissionFence = {
  express: () => ({ ok: true }),
  translate: translateCopilotCall,
  read: readCopilotFence,
  reply: copilotFenceReply,
  // Its `tool_search_tool` translates to `ToolSearch` (live suite, HIVE-343), deferred schemas as on Claude.
  grants: ['ToolSearch'],
};

/**
 * Adapter #3 (HIVE-343 headless, HIVE-280 sessions). Sessions write no shared file: their hooks
 * plugin is `launch`'s own `files`. HiveTTY's skills and prompt markers in a Copilot session are a
 * follow-up, as for Codex.
 */
export const copilotAdapter: HarnessAdapter = {
  id: 'copilot',
  capabilities: {
    resume: 'by-id',
    meters: false,
    contextDelivery: 'none',
    reportsCostUsd: false,
    enforcesTurns: false,
    enforcesBudget: false,
    reportsMcpStatus: false,
    agentMcp: [],
    conversationId: 'argv',
  },
  launch: launchCopilotSession,
  prepare: {
    sessionSettings: noSettings,
    agentSettings: noSettings,
    plugin: noFile,
    containerSet: noFile,
    mcpConfig: noFile,
  },
  readHook: readCopilotHook,
  contextReply: claudeCodeAdapter.contextReply,
  promptMarker: noMarkers,
  foldEdits: () => new Map(),
  meters: () => null,
  record: copilotRecord(),
  installed: {
    skillNames: () => Promise.resolve([]),
    pluginNames: () => Promise.resolve([]),
    sessionOverrides: () => Promise.resolve({}),
    skillPlaces: '',
  },
  headless: { launch: launchCopilotHeadless, reader: readCopilotHeadless, fence: copilotFence, containerCommand: 'copilot' },
};
