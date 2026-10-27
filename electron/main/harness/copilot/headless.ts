import {
  HOOK_ENV_GRANTS,
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_RUN,
  HOOK_ENV_RUN_TOKEN,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
} from '@shared/hook-contract';

import { fenceCommand, hookCommand } from '../hook-commands';
import type { HeadlessPlan, HeadlessSpec } from '../port';

/**
 * The command line one agent wake runs, in Copilot's spelling (HIVE-343). Pure: no spawn, no disk.
 * Measured against copilot 1.0.104-4 (`.hive/specs/2026-10-26-copilot-headless-runs.md` has the probes).
 *
 * - `COPILOT_HOME` is app-owned: the user's `~/.copilot` (plugins, MCP servers, hooks, login) never
 *   reaches an agent, and its `settings.json` carries the hive hooks, which fire under `-p` on a
 *   start and on a resume with no folder trust.
 * - `--allow-tool shell|write|hive`: Copilot's own layer must allow a kind before a call can run at
 *   all; the `preToolUse` hook (`/fence`) decides each call. A hook's allow grants nothing.
 * - No `--no-auto-update`: it runs the executable's bundled build, older than the user's own.
 * - The system prompt is `AGENTS.md` in the cwd, re-read on a resume (probed).
 */

/** What a parent Copilot session exports to its children (probed at 1.0.104). */
export const COPILOT_SESSION_ENV_KEYS = [
  'COPILOT_AGENT_SESSION_ID',
  'COPILOT_CLI',
  'COPILOT_CLI_BINARY_VERSION',
  'COPILOT_CLI_RESOLVED_DIST_DIR',
  'COPILOT_PROJECT_DIR',
  'COPILOT_CUSTOM_INSTRUCTIONS_DIRS',
] as const;

/** Outrank or widen the stored token, so they never reach a run (HIVE-343). */
export const COPILOT_AUTH_ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_ALLOW_ALL'] as const;

/**
 * Change who pays, which model or provider answers, or what is approved (`copilot help environment`
 * at 1.0.104, plus `COPILOT_ASSISTED_APPROVAL` and `GH_ENTERPRISE_TOKEN`), so they never reach a run.
 * `GH_HOST` and `COPILOT_GH_HOST` stay: a GitHub Enterprise user needs them for the stored token to
 * authenticate.
 */
export const COPILOT_ROUTING_ENV_KEYS = [
  'COPILOT_PROVIDER_BASE_URL',
  'COPILOT_PROVIDER_TYPE',
  'COPILOT_PROVIDER_API_KEY',
  'COPILOT_PROVIDER_API_KEY_COMMAND',
  'COPILOT_PROVIDER_BEARER_TOKEN',
  'COPILOT_PROVIDER_WIRE_API',
  'COPILOT_PROVIDER_TRANSPORT',
  'COPILOT_PROVIDER_AZURE_API_VERSION',
  'COPILOT_PROVIDER_MODEL_ID',
  'COPILOT_PROVIDER_WIRE_MODEL',
  'COPILOT_PROVIDER_MAX_PROMPT_TOKENS',
  'COPILOT_PROVIDER_MAX_OUTPUT_TOKENS',
  'COPILOT_PROVIDER_HEADERS',
  'COPILOT_OFFLINE',
  'COPILOT_MODEL',
  'COPILOT_AUTO_TIER',
  'COPILOT_ASSISTED_APPROVAL',
  'GH_ENTERPRISE_TOKEN',
] as const;

export const COPILOT_TOKEN_ENV = 'COPILOT_GITHUB_TOKEN';

/** What the hive MCP host reads, forwarded by name so no value lands on the argv. */
const HIVE_SERVER_ENV = [
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  HOOK_ENV_RUN,
  HOOK_ENV_RUN_TOKEN,
  HOOK_ENV_GRANTS,
];

/** What the fence hook prints when it cannot get an answer: copilot stops the call. */
const FENCE_DOWN = JSON.stringify({
  permissionDecision: 'deny',
  permissionDecisionReason:
    'HiveTTY could not be reached to check this call, so it was not run. End your turn.',
});

/** The home's `settings.json`: the same bytes for every run, since identity comes from the env. */
export const copilotSettings = (): string =>
  `${JSON.stringify(
    {
      banner: 'never',
      hooks: {
        agentStop: [
          {
            type: 'command',
            bash: hookCommand({ harness: 'copilot', wrap: 'agentStop' }),
            timeoutSec: 10,
          },
        ],
        // Over curl's own 30 s, so the hook's deny is what Copilot sees, never its timeout.
        preToolUse: [
          {
            type: 'command',
            bash: fenceCommand({ denyJson: FENCE_DOWN, harness: 'copilot' }),
            timeoutSec: 35,
          },
        ],
      },
    },
    null,
    2,
  )}\n`;

/** `${VAR}`, which Copilot expands from the run's env (probed). */
const envReference = (key: string): string => '${' + key + '}';

export function launchCopilotHeadless(spec: HeadlessSpec): HeadlessPlan {
  const { conversation, hiveServer } = spec;
  const id = 'start' in conversation ? conversation.start : conversation.resume;

  if (!('command' in hiveServer)) {
    throw new Error('copilot agents cannot run in a container yet: the hive server there is HTTP.');
  }

  const mcp = {
    mcpServers: {
      hive: {
        type: 'local',
        command: hiveServer.command,
        args: hiveServer.args,
        // By reference, so no value is on the argv.
        env: {
          ...hiveServer.env,
          ...Object.fromEntries(HIVE_SERVER_ENV.map((key) => [key, envReference(key)])),
        },
        tools: ['*'],
      },
    },
  };
  const usageFile = `${spec.stateDir}/usage/${id}.json`;

  return {
    args: [
      '-p',
      spec.prompt,
      '-s',
      '--no-ask-user',
      '--disable-builtin-mcps',
      // One flag for both: it resumes the session if it exists, else starts one with this id
      // (probed), so a first wake that died before Copilot made its session resumes cleanly.
      '--session-id',
      id,
      ...(spec.model === undefined ? [] : ['--model', spec.model]),
      ...(spec.effort === undefined ? [] : ['--reasoning-effort', spec.effort]),
      '--allow-tool',
      'shell',
      '--allow-tool',
      'write',
      '--allow-tool',
      'hive',
      ...(spec.deny ?? []).flatMap((pattern) => ['--deny-tool', pattern]),
      '--additional-mcp-config',
      JSON.stringify(mcp),
      '--secret-env-vars',
      COPILOT_TOKEN_ENV,
      '--usage-output-file',
      usageFile,
    ],
    addEnv: { COPILOT_HOME: spec.stateDir },
    stripEnv: [...COPILOT_SESSION_ENV_KEYS, ...COPILOT_AUTH_ENV_KEYS, ...COPILOT_ROUTING_ENV_KEYS],
    defaultContainerCommand: 'copilot',
    stopPattern: id,
    namesConversation: true,
    usageFile,
    files: [
      { path: `${spec.stateDir}/settings.json`, text: copilotSettings() },
      { path: `${spec.workdir}/AGENTS.md`, text: spec.instructions },
    ],
  };
}
