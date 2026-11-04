import type { CliDetection, ClisConfig } from '@shared/cli-contract';
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
