import type { Effort, Model } from '@/types/entity';

import { CLI_NAMES } from '@lib/harness/cli-names';
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

/** Where the picker's CLI came from (HIVE-378): this run's pick, the project's default, yours, or the first available. */
export type CliSource = 'picked' | 'project' | 'yours' | 'fallback';
export type CliRung = Exclude<CliSource, 'fallback'>;

export interface SessionCliChoice {
  /** `null` only when no CLI is available. */
  cli: HarnessId | null;
  source: CliSource | null;
  /**
   * Each rung that named a CLI that cannot run, highest first; never silently passed over ("no quiet downgrade").
   * Every rung is recorded, the same CLI twice included, so a project's skip is on record even when a stale run
   * pick named the same CLI first (HIVE-387).
   */
  skipped: { cli: HarnessId; source: CliRung; reason: string }[];
}

/**
 * The CLI a new session starts on (HIVE-378): this run's pick, then the project's default, then yours
 * (`sessionsDefaultCli`, absent meaning claude-code), then the first available. A rung naming an unavailable CLI
 * is skipped and recorded, so the dock can say so.
 */
export function resolveSessionCli(
  { picked, project, sessionsDefault }: { picked: HarnessId | null; project?: HarnessId; sessionsDefault?: HarnessId },
  availability: CliAvailability,
): SessionCliChoice {
  const rungs: [HarnessId | null | undefined, CliRung][] = [
    [picked, 'picked'],
    [project, 'project'],
    [sessionsDefault ?? 'claude-code', 'yours'],
  ];
  const skipped: SessionCliChoice['skipped'] = [];
  for (const [cli, source] of rungs) {
    if (cli === null || cli === undefined) continue;
    const entry = availability[cli];
    if (entry.ok) return { cli, source, skipped };
    skipped.push({ cli, source, reason: entry.reason });
  }
  const first = HARNESS_IDS.find((id) => availability[id].ok) ?? null;
  return { cli: first, source: first === null ? null : 'fallback', skipped };
}

const rungWords = (projectName: string | undefined): Record<CliRung, string> => ({
  picked: 'your pick',
  project: `the default for ${projectName ?? 'this project'}`,
  yours: 'your default',
});

/** The dock's caption (HIVE-378): where the CLI came from, and what was skipped to reach it. `null` says nothing. */
export function cliCaption(choice: SessionCliChoice, projectName?: string): string | null {
  const { cli, source, skipped } = choice;
  if (cli === null || source === null) return null;
  const words = rungWords(projectName);
  // The project's skip first: a stale run pick is already dimmed in the dock with its reason (HIVE-387).
  const first = skipped.find((entry) => entry.source === 'project') ?? skipped[0];
  if (first !== undefined) {
    const after = source === 'fallback' || source === 'picked' ? '' : ` (${words[source]})`;
    return `${CLI_NAMES[first.cli]}, ${words[first.source]}, isn't available · starting on ${CLI_NAMES[cli]}${after}`;
  }
  if (source === 'project') return `Default for ${projectName ?? 'this project'}`;
  if (source === 'yours') return 'Your default';
  return null;
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
