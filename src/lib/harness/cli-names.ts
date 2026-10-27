import type { HarnessId } from '@shared/harness-contract';

/** What each CLI is called on screen (HIVE-341; moved here for the picker, HIVE-279). */
export const CLI_NAMES: Record<HarnessId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  copilot: 'Copilot',
};
