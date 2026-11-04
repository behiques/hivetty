import type { Effort, Model } from '@/types/entity';

import { type CliDetection, type ClisConfig, CODEX_MODELS, COPILOT_MODELS } from '@shared/cli-contract';
import { HARNESS_IDS, type HarnessId } from '@shared/harness-contract';

export type CliAvailability = Record<HarnessId, { ok: true } | { ok: false; reason: string }>;

/** Read mid-sentence, after "<name> isn't available:" in the picker. */
export const TURNED_OFF = 'turned off in Settings › Harnesses';

/**
 * Whether each CLI may start a session (HIVE-375). No detection (the browser, or not yet answered) counts as found
 * (D10); a missing CLI's reason wins over its switch.
 */
export function cliAvailability(
  detection: Record<HarnessId, CliDetection> | null,
  clis: ClisConfig | null,
): CliAvailability {
  return Object.fromEntries(
    HARNESS_IDS.map((id) => {
      const found = detection?.[id];
      if (found !== undefined && 'missing' in found) return [id, { ok: false, reason: found.missing }];
      if (clis !== null && !clis[id].sessions) return [id, { ok: false, reason: TURNED_OFF }];
      return [id, { ok: true }];
    }),
  ) as CliAvailability;
}

/** The picker's first choice (D2): the pick, the default, then the first available. `null` only when none is. */
export function resolveSessionCli(
  picked: HarnessId | null,
  configuredDefault: HarnessId | undefined,
  availability: CliAvailability,
): HarnessId | null {
  const order = [picked, configuredDefault ?? 'claude-code', ...HARNESS_IDS];
  return order.find((id): id is HarnessId => id !== null && availability[id].ok) ?? null;
}

/** Why each unavailable CLI is, for the dock; an available one has no entry. */
export function unavailableReasons(availability: CliAvailability): Partial<Record<HarnessId, string>> {
  return Object.fromEntries(
    HARNESS_IDS.flatMap((id) => {
      const entry = availability[id];
      return entry.ok ? [] : [[id, entry.reason]];
    }),
  );
}

/** What a new session starts each CLI on (HIVE-279) when neither this run's pick nor Settings names one. */
export const BUILT_IN_PICKS: Record<HarnessId, { model: Model; effort: Effort }> = {
  // Unchanged from before this story: what every Claude chip has said since story 044.
  'claude-code': { model: 'opus', effort: 'high' },
  // Codex's own default model (CLI_VOCAB lists it first) at a middle effort.
  codex: { model: CODEX_MODELS[0], effort: 'medium' },
  // Copilot's `auto` (CLI_VOCAB lists it first) at a middle effort, as Codex's (HIVE-280).
  copilot: { model: COPILOT_MODELS[0], effort: 'medium' },
};

/** This run's picks, each field only once it was picked (HIVE-376). */
export type Picks = Partial<Record<HarnessId, { model?: Model; effort?: Effort }>>;

/** What a new session starts a CLI on (HIVE-376 D5): this run's pick, else Settings' default, else the built-in, each field on its own. */
export function resolvePick(cli: HarnessId, picks: Picks, clis: ClisConfig | null): { model: Model; effort: Effort } {
  const built = BUILT_IN_PICKS[cli];
  return {
    model: picks[cli]?.model ?? (clis?.[cli].sessionModel as Model | undefined) ?? built.model,
    effort: picks[cli]?.effort ?? (clis?.[cli].sessionEffort as Effort | undefined) ?? built.effort,
  };
}
