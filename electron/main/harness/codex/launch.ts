import { CLI_VOCAB } from '@shared/cli-contract';
import { HOOK_ENV_RECEIVER_URL, HOOK_ENV_SESSION, HOOK_ENV_TOKEN } from '@shared/hook-contract';

import { shellQuote } from '../../container/shell-quote';
import { SUBMIT_DELAY_MS } from '../claude-code/launch';
import { hookCommand } from '../hook-commands';
import type { LaunchPlan, LaunchSpec } from '../port';

import { CODEX_AUTH_ENV_KEYS, CODEX_SESSION_ENV_KEYS } from './headless';
import { hookEntry, toml, tomlList, tomlTable } from './toml';

/**
 * An interactive Codex session's command line (HIVE-279), measured against codex-cli 0.164.0 in
 * `tests/fixtures/codex/interactive-0.164/FINDINGS.md`; `docs/harness-architecture.md` has each flag.
 *
 * - No `--ignore-user-config` (D2): the user's config.toml applies, its model, MCP servers and
 *   hooks included, and every `-c` here is added beside it (P5), as `--settings` leaves Claude's
 *   own settings alone.
 * - `-c tools.update_plan.enabled=true`: the TUI has no plan tool without it (P4).
 * - `-c tui.disable_paste_burst=true`: an injected Enter is a keystroke, not the tail of a paste (P7).
 * - `--dangerously-bypass-hook-trust`: `-c` hooks fire only with it (P1). It also runs a repo's own
 *   `.codex` hooks (P2), so the core asks for it only where a repo has none (D4).
 */

/** What a session reports, measured in FINDINGS P3. No Notification: idle is `Stop`. */
export const CODEX_SESSION_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop'] as const;

/** The session identity the hive server reads, forwarded by name so no token is on the argv. */
const HIVE_SESSION_ENV = [HOOK_ENV_RECEIVER_URL, HOOK_ENV_SESSION, HOOK_ENV_TOKEN];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A `-c` override, quoted: unlike headless's argv, this string is parsed by a login shell. */
const config = (pair: string): string[] => ['-c', shellQuote(pair)];

/** Closed lists, re-checked here: the guard checked them, and nothing below quotes `-m`. */
const oneOf = (what: string, value: string, allowed: readonly string[]): string => {
  if (!allowed.includes(value)) throw new Error(`codex: refusing ${what} ${JSON.stringify(value)}.`);
  return value;
};

/**
 * `codex [resume <id>] … [-- '<task>'] && exit`, typed into a login shell like Claude's (see
 * `sessionCommand` for `&& exit`, the task as an argument, and `--`). A fresh start names no id:
 * codex picks it and the first hook reports it (`conversationId: 'first-hook'`).
 */
export function launchCodexSession(spec: LaunchSpec): LaunchPlan {
  const { model, effort, sessionUuid, resume = false, task, hiveServer } = spec;
  const resuming = resume && sessionUuid !== undefined && UUID.test(sessionUuid);

  const flags = [
    ...(model === undefined ? [] : ['-m', oneOf('model', model, CLI_VOCAB.codex.models)]),
    ...(effort === undefined
      ? []
      : config(`model_reasoning_effort=${toml(oneOf('effort', effort, CLI_VOCAB.codex.efforts))}`)),
    ...config('tui.disable_paste_burst=true'),
    ...config('tools.update_plan.enabled=true'),
    ...CODEX_SESSION_EVENTS.flatMap((event) => config(hookEntry(event, hookCommand()))),
    ...config(hookEntry('PostToolUse', hookCommand(), '*')),
    ...(hiveServer === undefined
      ? []
      : [
          ...config(`mcp_servers.hive.command=${toml(hiveServer.command)}`),
          ...config(`mcp_servers.hive.args=${tomlList(hiveServer.args)}`),
          // On the argv as written: `hiveServer.env` must never carry a secret, which goes by name below.
          ...config(`mcp_servers.hive.env=${tomlTable(hiveServer.env)}`),
          ...config(`mcp_servers.hive.env_vars=${tomlList(HIVE_SESSION_ENV)}`),
        ]),
    ...(spec.bypassHookTrust === true ? ['--dangerously-bypass-hook-trust'] : []),
  ];

  // As Claude's `sessionCommand` does (HIVE-79): the login shell re-sources the user's profile
  // after `stripEnv`, so a key exported there would otherwise come back and bill the API.
  const prefix = spec.subscriptionAuth === true ? [`unset ${CODEX_AUTH_ENV_KEYS.join(' ')};`] : [];

  const initialPrompt =
    task === undefined || task.trim() === '' || resuming
      ? []
      : ['--', shellQuote(task.replaceAll(/[\r\n]+/g, ' ').trim())];

  return {
    command: [...prefix, spec.command, ...(resuming ? ['resume', sessionUuid] : []), ...flags, ...initialPrompt, '&& exit'].join(
      ' ',
    ),
    stripEnv: [...CODEX_SESSION_ENV_KEYS, ...(spec.subscriptionAuth === true ? CODEX_AUTH_ENV_KEYS : [])],
    submitDelayMs: SUBMIT_DELAY_MS,
  };
}
