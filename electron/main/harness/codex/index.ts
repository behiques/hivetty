import { claudeCodeAdapter } from '../claude-code';
import type { HarnessAdapter } from '../port';

import { codexFence } from './fence';
import { launchCodexHeadless } from './headless';
import { readCodexHeadless } from './headless-reader';
import { readCodexHook } from './hooks';

const NO_SESSIONS = 'codex has no interactive sessions yet (HIVE-279).';

const interactive = (): never => {
  throw new Error(NO_SESSIONS);
};
const later = (): Promise<never> => Promise.reject(new Error(NO_SESSIONS));

/**
 * Adapter #2, headless only (HIVE-342). The interactive half is HIVE-279's: `sessionAdapter()`
 * and `harnessOf` answer Claude, so nothing interactive reaches these refusals. `readHook` is
 * Claude's, because codex 0.164 sends Claude-shaped payloads, plus `update_plan` (`./hooks`).
 */
export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  capabilities: {
    resume: 'by-id',
    meters: false,
    contextDelivery: 'none',
    reportsCostUsd: false,
    enforcesTurns: false,
    enforcesBudget: false,
    reportsMcpStatus: false,
    agentMcp: [],
    conversationId: 'first-hook',
  },
  launch: interactive,
  prepare: {
    sessionSettings: later,
    agentSettings: later,
    plugin: later,
    containerSet: later,
    mcpConfig: later,
  },
  readHook: readCodexHook,
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
  headless: { launch: launchCodexHeadless, reader: readCodexHeadless, fence: codexFence, containerCommand: 'codex' },
};
