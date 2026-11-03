import { CAPABILITIES } from '@shared/harness-contract';

import { blockAnswer } from '../block-answer';
import { claudeCodeAdapter } from '../claude-code';
import type { HarnessAdapter } from '../port';

import { codexFence } from './fence';
import { launchCodexHeadless } from './headless';
import { readCodexHeadless } from './headless-reader';
import { readCodexHook } from './hooks';
import { launchCodexSession } from './launch';
import { foldCodexMeters } from './meters';
import { readCodexModels } from './models';
import { codexRecord, codexRecordAborted } from './record';
import { codexSkills } from './skills';

/*
  A Codex session's hooks and MCP server are `-c` overrides on its argv (`./launch`); nothing is
  written, and the shared runtimes calling `sessionAdapter()` still write Claude's (HIVE-279).
*/
const noSettings = (): Promise<string> => Promise.resolve('');
const noFile = (): Promise<void> => Promise.resolve();

const noMarkers = (): never => {
  throw new Error('codex sessions take no markers yet (HIVE-279 follow-up).');
};

/**
 * Adapter #2: headless (HIVE-342) and interactive (HIVE-279). `readHook` is Claude's, because
 * codex 0.164 sends Claude-shaped payloads, plus `update_plan` (`./hooks`). HiveTTY's skills reach
 * a Codex session as `developer_instructions` (HIVE-360). Prompt markers stay off: codex 0.165 does
 * not hand a `UserPromptSubmit` hook's context to the model (HIVE-360 D6, measured live).
 */
export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  capabilities: CAPABILITIES.codex,
  launch: launchCodexSession,
  prepare: {
    sessionSettings: noSettings,
    agentSettings: noSettings,
    containerSet: noFile,
    mcpConfig: noFile,
  },
  readHook: readCodexHook,
  contextReply: claudeCodeAdapter.contextReply,
  promptMarker: noMarkers,
  foldEdits: () => new Map(),
  meters: () => null,
  foldMeters: foldCodexMeters,
  record: codexRecord(),
  installed: {
    skillNames: () => Promise.resolve([]),
    pluginNames: () => Promise.resolve([]),
    sessionOverrides: () => Promise.resolve({}),
    skillPlaces: '',
  },
  skills: codexSkills,
  headless: { launch: launchCodexHeadless, reader: readCodexHeadless, fence: codexFence, containerCommand: 'codex' },
  models: () => readCodexModels(),
  answersBlock: blockAnswer,
  recordAborted: codexRecordAborted,
};
