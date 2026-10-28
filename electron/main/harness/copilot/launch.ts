import { CLI_VOCAB, cliTakesEffort } from '@shared/cli-contract';
import { HOOK_ENV_RECEIVER_URL, HOOK_ENV_SESSION, HOOK_ENV_TOKEN } from '@shared/hook-contract';

import { shellQuote } from '../../container/shell-quote';
import { SUBMIT_DELAY_MS } from '../claude-code/launch';
import { hookCommand } from '../hook-commands';
import type { LaunchPlan, LaunchSpec } from '../port';

import { COPILOT_SESSION_ENV_KEYS, COPILOT_TOKEN_ENV, copilotMcpConfig } from './headless';

/**
 * An interactive Copilot session's command line (HIVE-280), measured against copilot 1.0.105 in
 * `tests/fixtures/copilot/interactive-1.0.105/FINDINGS.md`.
 *
 * - The user's `~/.copilot` is kept (D2): no `COPILOT_HOME`, so their login, MCP servers, plugins and
 *   trusted folders apply. HiveTTY's hooks come from an app-owned `--plugin-dir` (P0), the hive
 *   server from `--additional-mcp-config` (P7); both add to the user's own.
 * - `--session-id` starts and resumes alike (HIVE-343), so the core pins it (`conversationId: 'argv'`).
 * - The user's login authenticates (D3): the token keys are unset, in the pty and after the profile.
 */

/** What a session reports (P0, P1), and `notification` for an `ask_user` dialog (P2). */
export const COPILOT_SESSION_EVENTS = [
  'sessionStart',
  'userPromptSubmitted',
  'permissionRequest',
  'postToolUse',
  'agentStop',
  'notification',
] as const;

/** They outrank the user's own login (D3). */
export const COPILOT_SESSION_TOKEN_KEYS = [COPILOT_TOKEN_ENV, 'GH_TOKEN', 'GITHUB_TOKEN'] as const;

/**
 * They approve calls before `permissionRequest` can fire, so no "needs you" card would ever show
 * (HIVE-363). Headless strips both; BYOK provider and Enterprise host keys stay, as the user's routing.
 */
export const COPILOT_SESSION_APPROVAL_KEYS = ['COPILOT_ALLOW_ALL', 'COPILOT_ASSISTED_APPROVAL'] as const;

/** Unset in the pty and again after the login shell's profile. */
const UNSET_KEYS = [...COPILOT_SESSION_TOKEN_KEYS, ...COPILOT_SESSION_APPROVAL_KEYS];

/** The session identity the hive server reads, forwarded by name. No run: a session is not one. */
const HIVE_SESSION_ENV = [HOOK_ENV_RECEIVER_URL, HOOK_ENV_SESSION, HOOK_ENV_TOKEN];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Closed lists, re-checked here: the guard checked them, and nothing below quotes `--model`. */
const oneOf = (what: string, value: string, allowed: readonly string[]): string => {
  if (!allowed.includes(value)) throw new Error(`copilot: refusing ${what} ${JSON.stringify(value)}.`);
  return value;
};

/** The hooks plugin: the same bytes for every session, since identity comes from the env. */
export const copilotPluginFiles = (dir: string): { path: string; text: string }[] => [
  {
    path: `${dir}/plugin.json`,
    text: `${JSON.stringify({ name: 'hivetty', version: '1.0.0', description: 'HiveTTY session hooks' }, null, 2)}\n`,
  },
  {
    path: `${dir}/hooks/hooks.json`,
    text: `${JSON.stringify(
      {
        version: 1,
        hooks: Object.fromEntries(
          COPILOT_SESSION_EVENTS.map((event) => [
            event,
            [{ type: 'command', bash: hookCommand({ harness: 'copilot', wrap: event }), timeoutSec: 10 }],
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  },
];

/** `unset …; copilot --session-id <id> … [-i '<task>'] && exit`, typed into a login shell like Codex's. */
export function launchCopilotSession(spec: LaunchSpec): LaunchPlan {
  const { model, effort, sessionUuid, resume = false, task, hiveServer, stateDir } = spec;
  if (sessionUuid === undefined || !UUID.test(sessionUuid)) {
    throw new Error('copilot: a session needs a pinned uuid.');
  }
  if (stateDir === undefined) throw new Error('copilot: a session needs a state directory for its hooks plugin.');
  const pluginDir = `${stateDir}/plugin`;

  const flags = [
    '--session-id',
    sessionUuid,
    ...(model === undefined ? [] : ['--model', oneOf('model', model, CLI_VOCAB.copilot.models)]),
    // A model with no effort scale refuses the flag (P8), so it is left off rather than refused here.
    ...(effort === undefined || (model !== undefined && !cliTakesEffort('copilot', model))
      ? []
      : ['--reasoning-effort', oneOf('effort', effort, CLI_VOCAB.copilot.efforts)]),
    '--plugin-dir',
    shellQuote(pluginDir),
    ...(hiveServer === undefined
      ? []
      : ['--additional-mcp-config', shellQuote(JSON.stringify(copilotMcpConfig(hiveServer, HIVE_SESSION_ENV)))]),
  ];
  const initialPrompt =
    task === undefined || task.trim() === '' || resume
      ? []
      : ['-i', shellQuote(task.replaceAll(/[\r\n]+/g, ' ').trim())];

  return {
    // As Codex's: the login shell re-sources the profile after `stripEnv`, so `unset` runs after it.
    command: [`unset ${UNSET_KEYS.join(' ')};`, spec.command, ...flags, ...initialPrompt, '&& exit'].join(
      ' ',
    ),
    stripEnv: [...COPILOT_SESSION_ENV_KEYS, ...UNSET_KEYS],
    submitDelayMs: SUBMIT_DELAY_MS,
    files: copilotPluginFiles(pluginDir),
  };
}
