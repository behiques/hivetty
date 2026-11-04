import { CAPABILITIES } from '@shared/harness-contract';

import { blockAnswer } from '../block-answer';
import { claudeCodeAdapter } from '../claude-code';
import type { HarnessAdapter, PermissionFence } from '../port';

import { copilotFenceReply, readCopilotFence, translateCopilotCall } from './fence';
import { launchCopilotHeadless } from './headless';
import { readCopilotHeadless } from './headless-reader';
import { readCopilotHook } from './hooks';
import { createCopilotInstalled } from './installed';
import { launchCopilotSession } from './launch';
import { foldCopilotMeters } from './meters';
import { copilotRecord, copilotRecordAborted } from './record';
import { copilotSkills } from './skills';

/* A Copilot session's hooks plugin is its launch's own `files` (`./launch`); nothing shared is written. */
const noSettings = (): Promise<string> => Promise.resolve('');
const noFile = (): Promise<void> => Promise.resolve();

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
 * plugin is `launch`'s own `files`. HiveTTY's skills and the ledger marker rule ride a second
 * `--plugin-dir` and `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` (HIVE-362).
 */
export const copilotAdapter: HarnessAdapter = {
  id: 'copilot',
  capabilities: CAPABILITIES.copilot,
  launch: launchCopilotSession,
  prepare: {
    sessionSettings: noSettings,
    agentSettings: noSettings,
    containerSet: noFile,
    mcpConfig: noFile,
  },
  readHook: readCopilotHook,
  // An Esc on Copilot's own prompt fires no hook (FINDINGS P1): the keystroke clears the card.
  answersBlock: blockAnswer,
  recordAborted: copilotRecordAborted,
  contextReply: claudeCodeAdapter.contextReply,
  // HIVE-362: never the body (ledger/context.ts); never a leading '$' (FINDINGS P6).
  promptMarker: claudeCodeAdapter.promptMarker,
  foldEdits: () => new Map(),
  meters: () => null,
  // HIVE-335: no status line; its OTel export, summed. `foldMeters` also keeps `/statusline` 404.
  foldMeters: foldCopilotMeters,
  meterExport: true,
  record: copilotRecord(),
  installed: createCopilotInstalled(),
  skills: copilotSkills,
  headless: { launch: launchCopilotHeadless, reader: readCopilotHeadless, fence: copilotFence, containerCommand: 'copilot' },
};
