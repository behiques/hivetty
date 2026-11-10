import { vi } from 'vitest';

import type { RunsOnContext } from '@features/shared/components/agent-form';
import { CODEX_FALLBACK_MODELS } from '@shared/cli-contract';

/** Every CLI pickable, Claude Code the default, no card models: the Runs on group at rest. */
export const runsOn = (over: Partial<RunsOnContext> = {}): RunsOnContext => ({
  verdicts: null,
  defaultCli: 'claude-code',
  cardModels: {},
  codexModels: CODEX_FALLBACK_MODELS,
  openHarness: vi.fn(),
  ...over,
});
