/**
 * Per-CLI settings (HIVE-341): what Settings › CLIs stores for each harness and the vocabulary its
 * fields take. Data and pure functions only: this module follows `electron/shared`'s rule.
 *
 * Its own module rather than `harness-contract.ts`: `session-contract` imports that one, and the
 * vocabulary below imports `session-contract` back.
 */
import { HARNESS_IDS, type HarnessId } from './harness-contract';
import { SESSION_EFFORTS, SESSION_MODELS } from './session-contract';

/**
 * Codex's models when the account's own list cannot be read: `~/.codex/models_cache.json`'s listed
 * entries at 0.165, in its priority order. The first is its default. The live list comes from the
 * Codex adapter's `models()`; this is only the fallback.
 */
export const CODEX_MODELS = [
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6.1-terra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const;

/** Codex's `model_reasoning_effort` values at 0.165. `ultra` is per model: Luna lacks it. */
export const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

/** Copilot's models, from `copilot help config` at 1.0.104 (HIVE-343). `auto` lets Copilot pick. */
export const COPILOT_MODELS = [
  'auto',
  'claude-sonnet-5.5',
  'claude-sonnet-5',
  'claude-fable-5.1',
  'claude-fable-5',
  'claude-opus-5.5',
  'claude-opus-5',
  'claude-opus-4.8',
  'claude-opus-4.8-fast',
  'claude-sonnet-4.6',
  'claude-haiku-5.5',
  'claude-haiku-4.5',
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5-mini',
  'mai-code-1.1-flash',
  'gemini-4-argon',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'grok-4.7',
  'grok-4.6',
  'grok-4.5',
  'kimi-k3',
] as const;

/** `--reasoning-effort`'s values at 1.0.104 (HIVE-343). */
export const COPILOT_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** One `--deny-tool` pattern: `kind(arg?)`, kind `shell`, `write`, `url` or an MCP server's name (HIVE-343). */
export const COPILOT_DENY_PATTERN = /^[A-Za-z][\w.-]*(\([^()\n]{0,200}\))?$/;

/** The most deny patterns one Copilot card holds (HIVE-343). */
export const COPILOT_DENY_MAX = 50;

/** The sandboxes a Codex run may get (HIVE-342); `danger-full-access` is never offered. */
export const HEADLESS_SANDBOXES = ['read-only', 'workspace-write'] as const;

/** The sandbox a Codex run gets (HIVE-342). */
export type HeadlessSandbox = (typeof HEADLESS_SANDBOXES)[number];

/**
 * The models and efforts each CLI accepts: the closed lists the config parser, the IPC guard and
 * the card all read. A CLI adds a row here (HIVE-342, HIVE-343); nothing translates between rows.
 */
export const CLI_VOCAB = {
  // Haiku does not think, so the effort scale beside it does not apply (HIVE-100).
  'claude-code': { models: SESSION_MODELS, efforts: SESSION_EFFORTS, noEffort: ['haiku'] },
  codex: { models: CODEX_MODELS, efforts: CODEX_EFFORTS, noEffort: [] },
  // kimi-k3 refuses `--reasoning-effort` (HIVE-280, tests/fixtures/copilot/interactive-1.0.105/FINDINGS.md P8).
  copilot: { models: COPILOT_MODELS, efforts: COPILOT_EFFORTS, noEffort: ['kimi-k3'] },
} as const satisfies Record<
  HarnessId,
  { models: readonly string[]; efforts: readonly string[]; noEffort: readonly string[] }
>;

/** Whether `model`'s effort scale applies on `cli` (HIVE-279): the picker dims it when not. */
export const cliTakesEffort = (cli: HarnessId, model: string): boolean =>
  !(CLI_VOCAB[cli].noEffort as readonly string[]).includes(model);

/**
 * A Codex model as the guard, the parser and the launch accept it. Codex's list is the account's,
 * so the check is a shape, not membership. No character in it is one a login shell reads, which is
 * what keeps `-m` unquoted in `launch.ts`.
 */
export const CODEX_MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Whether `model` is one `cli` takes: Codex's by {@link CODEX_MODEL_ID}, the others' by their lists. */
export const cliAcceptsModel = (cli: HarnessId, model: string): boolean =>
  cli === 'codex'
    ? CODEX_MODEL_ID.test(model)
    : (CLI_VOCAB[cli].models as readonly string[]).includes(model);

/** One model a CLI offers this account, as the picker draws it. Codex's come from its `models_cache.json`. */
export interface CliModel {
  slug: string;
  /** Codex's own one line on it; `''` when there is none. */
  description: string;
  defaultEffort: string;
  efforts: string[];
}

/** Codex's model classes, cheapest to most capable: the picker's stepper order. */
export const CODEX_CLASSES = ['luna', 'terra', 'sol', 'astra'] as const;

export type CodexClass = (typeof CODEX_CLASSES)[number];

const CODEX_FAMILY = /^gpt-(\d+(?:\.\d+)*)-(luna|terra|sol|astra)$/;

/** `gpt-<version>-<class>` read apart; `null` for a slug that is not one. */
export function codexFamily(slug: string): { cls: CodexClass; version: string } | null {
  const match = CODEX_FAMILY.exec(slug);
  return match === null ? null : { cls: match[2] as CodexClass, version: match[1]! };
}

/** The picker's list when Codex's own cannot be read. No `ultra`: only the live list says who takes it. */
export const CODEX_FALLBACK_MODELS: readonly CliModel[] = CODEX_MODELS.map((slug) => ({
  slug,
  description: '',
  defaultEffort: 'medium',
  efforts: CODEX_EFFORTS.filter((effort) => effort !== 'ultra'),
}));

/**
 * A CLI's headless agent defaults. An absent model or effort omits the flag: the CLI picks. Each is
 * a member of `CLI_VOCAB[cli]`, which the parser and the guard check (HIVE-342).
 */
export interface CliAgents {
  enabled: boolean;
  model?: string;
  effort?: string;
  /** Codex only (HIVE-342). Absent runs `workspace-write`. */
  sandbox?: HeadlessSandbox;
  /** Copilot only (HIVE-343). */
  deny?: string[];
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
  model?: string | null;
  effort?: string | null;
  /** Codex only (HIVE-342). */
  sandbox?: HeadlessSandbox | null;
  /** Copilot only (HIVE-343). `null` clears the list. */
  deny?: string[] | null;
}

/** The CLIs whose agents sign in with a token HiveTTY holds (HIVE-343). */
export const CLI_TOKEN_IDS = ['copilot'] as const;

export type CliTokenId = (typeof CLI_TOKEN_IDS)[number];

/** Presence only: no answer ever carries a token (HIVE-343, Slack's rule). */
export interface CliTokensState {
  copilot: boolean;
  encryptionAvailable: boolean;
}

/** Payload of `cli:set-token` (HIVE-343). */
export interface SetCliTokenRequest {
  cli: CliTokenId;
  token: string;
}

/** Payload of `cli:clear-token` (HIVE-343). */
export interface ClearCliTokenRequest {
  cli: CliTokenId;
}

/** Payload of `config:set-agents-default-cli` (HIVE-342). `null` clears it: resolution falls back to claude-code. */
export interface SetAgentsDefaultCliRequest {
  cli: HarnessId | null;
}
