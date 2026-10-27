import { claudeCodeAdapter } from '../claude-code';
import type { HarnessAdapter, PermissionFence } from '../port';

import { launchCopilotHeadless } from './headless';
import { readCopilotHeadless } from './headless-reader';

const NO_SESSIONS = 'copilot has no interactive sessions yet (HIVE-280).';

const interactive = (): never => {
  throw new Error(NO_SESSIONS);
};
const later = (): Promise<never> => Promise.reject(new Error(NO_SESSIONS));

/** Refuses every rule set: no Copilot run may start before its `/fence` reader exists (HIVE-343 PR2). */
export const copilotFence: PermissionFence = { express: () => ({ ok: false, unexpressible: ['*'] }) };

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
  // Claude's until PR2 gives copilot its own (HIVE-343): no copilot run starts before then.
  readHook: claudeCodeAdapter.readHook,
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
  },
  headless: { launch: launchCopilotHeadless, reader: readCopilotHeadless, fence: copilotFence },
};
