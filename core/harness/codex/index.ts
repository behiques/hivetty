import { CAPABILITIES } from '@shared/harness-contract';

import { blockAnswer } from '../block-answer';
import { claudeCodeAdapter } from '../claude-code';
import type { HarnessAdapter } from '../port';

import { codexFence } from './fence';
import { launchCodexHeadless } from './headless';
import { readCodexHeadless } from './headless-reader';
import { readCodexHook } from './hooks';
import { createCodexInstalled } from './installed';
import { launchCodexSession } from './launch';
import { foldCodexMeters } from './meters';
import { readCodexModels } from './models';
import { createCodexPluginInstaller } from './plugin-install';
import { codexHome, codexRecord, codexRecordAborted } from './record';
import { codexSkills } from './skills';

/*
  A Codex session's hooks and MCP server are `-c` overrides on its argv (`./launch`); nothing is
  written, and the shared runtimes calling `sessionAdapter()` still write Claude's (HIVE-279).
*/
const noSettings = (): Promise<string> => Promise.resolve('');
const noFile = (): Promise<void> => Promise.resolve();

/**
 * Adapter #2: headless (HIVE-342) and interactive (HIVE-279). `readHook` is Claude's, because
 * codex 0.164 sends Claude-shaped payloads, plus `update_plan` (`./hooks`). HiveTTY's skills reach
 * a Codex session as `developer_instructions` (HIVE-360). Prompt markers are Claude's bytes, and
 * their entry comes back as Claude's `additionalContext`, printed by the prompt hook's
 * `contextCommand` (HIVE-360 D6: codex 0.165 reads it from stdout).
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
  promptMarker: claudeCodeAdapter.promptMarker,
  foldEdits: () => new Map(),
  meters: () => null,
  foldMeters: foldCodexMeters,
  record: codexRecord(),
  installed: createCodexInstalled(),
  skills: codexSkills,
  headless: { launch: launchCodexHeadless, reader: readCodexHeadless, fence: codexFence, containerCommand: 'codex' },
  models: () => readCodexModels(),
  // HIVE-372: the same CODEX_HOME its sessions read, the runtime env's when it sets one.
  skillsPlugin: (deps) => createCodexPluginInstaller({ ...deps, codexHome: () => deps.env()['CODEX_HOME'] ?? codexHome() }),
  answersBlock: blockAnswer,
  recordAborted: codexRecordAborted,
};
