import { claudeCodeAdapter } from '../claude-code';
import type { HarnessAdapter, PermissionFence } from '../port';

import { copilotFenceReply, readCopilotFence, translateCopilotCall } from './fence';
import { launchCopilotHeadless } from './headless';
import { readCopilotHeadless } from './headless-reader';
import { readCopilotHook } from './hooks';

const NO_SESSIONS = 'copilot has no interactive sessions yet (HIVE-280).';

const interactive = (): never => {
  throw new Error(NO_SESSIONS);
};
const later = (): Promise<never> => Promise.reject(new Error(NO_SESSIONS));

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
 * Adapter #3, headless only (HIVE-343). The interactive half is HIVE-280's: `sessionAdapter()`
 * and `harnessOf` answer Claude, so nothing interactive reaches these refusals.
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
  },
  launch: interactive,
  prepare: {
    sessionSettings: later,
    agentSettings: later,
    plugin: later,
    containerSet: later,
    mcpConfig: later,
  },
  readHook: readCopilotHook,
  contextReply: claudeCodeAdapter.contextReply,
  promptMarker: interactive,
  foldEdits: () => new Map(),
  meters: () => null,
  record: {
    transcriptPath: () => null,
    hasTranscript: () => false,
    titleOrigin: () => 'unknown',
    nameFromTitle: (title) => title,
  },
  installed: {
    skillNames: () => Promise.resolve([]),
    pluginNames: () => Promise.resolve([]),
    sessionOverrides: () => Promise.resolve({}),
    skillPlaces: '',
  },
  headless: { launch: launchCopilotHeadless, reader: readCopilotHeadless, fence: copilotFence, containerCommand: 'copilot' },
};
