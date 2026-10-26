/**
 * Per-CLI settings (HIVE-341): what Settings › CLIs stores for each harness and the vocabulary its
 * fields take. Data and pure functions only: this module follows `electron/shared`'s rule.
 *
 * Its own module rather than `harness-contract.ts`: `session-contract` imports that one, and the
 * vocabulary below imports `session-contract` back.
 */
import { HARNESS_IDS, type HarnessId } from './harness-contract';
import {
  SESSION_EFFORTS,
  SESSION_MODELS,
  type SessionEffort,
  type SessionModel,
} from './session-contract';

/**
 * The models and efforts each CLI accepts: the closed lists the config parser, the IPC guard and
 * the card all read. A CLI adds a row here (HIVE-342, HIVE-343); nothing translates between rows.
 */
export const CLI_VOCAB = {
  'claude-code': { models: SESSION_MODELS, efforts: SESSION_EFFORTS },
} as const satisfies Record<HarnessId, { models: readonly string[]; efforts: readonly string[] }>;

/** A CLI's headless agent defaults. An absent model or effort omits the flag: the CLI picks. */
export interface CliAgents {
  enabled: boolean;
  model?: SessionModel;
  effort?: SessionEffort;
}

export interface CliConfig {
  agents: CliAgents;
}

/** Every CLI, always resolved: a CLI the file never names is enabled with no defaults. */
export type ClisConfig = Record<HarnessId, CliConfig>;

/** The `clis` block as the file declared it, kept partial so a write can tell chosen from absent. */
export type RawClis = Partial<Record<HarnessId, { agents?: Partial<CliAgents> }>>;

export function resolveClis(raw: RawClis | undefined): ClisConfig {
  return Object.fromEntries(
    HARNESS_IDS.map((id) => [id, { agents: { enabled: true, ...raw?.[id]?.agents } }]),
  ) as ClisConfig;
}

/**
 * Payload of `config:set-cli-agents` (HIVE-341). An absent field is left alone; `null` clears a
 * default back to the CLI's own.
 */
export interface SetCliAgentsRequest {
  cli: HarnessId;
  enabled?: boolean;
  model?: SessionModel | null;
  effort?: SessionEffort | null;
}
