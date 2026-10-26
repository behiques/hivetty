import {
  HOOK_ENV_GRANTS,
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_RUN,
  HOOK_ENV_RUN_TOKEN,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  HOOK_HEADER_SESSION,
  HOOK_HEADER_TOKEN,
  HOOK_PATH,
} from '@shared/hook-contract';

import type { HeadlessPlan, HeadlessSpec, PermissionFence } from '../port';

/**
 * The command line one agent wake runs, in Codex's spelling (HIVE-342). Pure: no spawn, no disk.
 * Measured against codex-cli 0.164.0; `docs/harness-architecture.md` has the why of each flag.
 *
 * - `--ignore-user-config`: the user's `config.toml` (plugins, MCP servers, profiles) never
 *   reaches an agent. Auth still comes from `CODEX_HOME`, which is never moved.
 * - `--dangerously-bypass-hook-trust`: hooks given through `-c` fire only with it. Every hook it
 *   trusts is this argv's own, since user config is ignored.
 * - `--skip-git-repo-check`: an agent's workdir is not a repo.
 * - `resume` has no `-s`, so the sandbox is `-c sandbox_mode` on both shapes.
 * - `developer_instructions` only on a first wake: a resumed thread keeps them (probed).
 */

/** What a parent Codex session exports to its children (probed at 0.164.0). Never `CODEX_HOME`. */
export const CODEX_SESSION_ENV_KEYS = [
  'CODEX_SESSION_ID',
  'CODEX_THREAD_ID',
  'CODEX_TOOL_CALL_ID',
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_CI',
  'CODEX_VERSION',
  'CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS',
] as const;

/** Removed under subscription auth, so the stored ChatGPT login is what pays (HIVE-79's rule). */
export const CODEX_AUTH_ENV_KEYS = ['OPENAI_API_KEY', 'CODEX_API_KEY'] as const;

/** What the hive MCP host reads, forwarded by name so no value lands on the argv. */
const HIVE_SERVER_ENV = [
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  HOOK_ENV_RUN,
  HOOK_ENV_RUN_TOKEN,
  HOOK_ENV_GRANTS,
];

/** A TOML basic string. JSON's escapes are a subset of TOML's, so `JSON.stringify` is one. */
export const toml = (value: string): string => JSON.stringify(value);
const tomlList = (values: readonly string[]): string => `[${values.map(toml).join(',')}]`;
const tomlTable = (record: Record<string, string>): string =>
  `{${Object.entries(record)
    .map(([key, value]) => `${toml(key)}=${toml(value)}`)
    .join(',')}}`;

/** The hook's POST, reading the identity from the run's environment as the container transport does. */
export const hookCommand = (): string =>
  `curl -sS -m 3 -X POST "$${HOOK_ENV_RECEIVER_URL}${HOOK_PATH}"` +
  ` -H 'content-type: application/json'` +
  ` -H "${HOOK_HEADER_SESSION}: $${HOOK_ENV_SESSION}"` +
  ` -H "${HOOK_HEADER_TOKEN}: $${HOOK_ENV_TOKEN}"` +
  ` --data-binary @- >/dev/null 2>&1 || true`;

const hooks = (event: string, command: string, matcher?: string): string =>
  `hooks.${event}=[{${matcher === undefined ? '' : `matcher=${toml(matcher)},`}hooks=[{type="command",command=${toml(command)}}]}]`;

const config = (pair: string): string[] => ['-c', pair];

export function launchCodexHeadless(spec: HeadlessSpec): HeadlessPlan {
  const { conversation, hiveServer } = spec;
  const start = 'start' in conversation;
  const id = start ? conversation.start : conversation.resume;

  if (!('command' in hiveServer)) {
    throw new Error('codex agents cannot run in a container yet: the hive server there is HTTP.');
  }

  return {
    args: [
      'exec',
      ...(start ? [] : ['resume', id]),
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--dangerously-bypass-hook-trust',
      ...(spec.model === undefined ? [] : ['-m', spec.model]),
      ...(spec.effort === undefined ? [] : config(`model_reasoning_effort=${toml(spec.effort)}`)),
      ...config(`sandbox_mode=${toml(spec.sandbox ?? 'workspace-write')}`),
      ...(start ? config(`developer_instructions=${toml(spec.instructions)}`) : []),
      ...config(`mcp_servers.hive.command=${toml(hiveServer.command)}`),
      ...config(`mcp_servers.hive.args=${tomlList(hiveServer.args)}`),
      ...config(`mcp_servers.hive.env=${tomlTable(hiveServer.env)}`),
      ...config(`mcp_servers.hive.env_vars=${tomlList(HIVE_SERVER_ENV)}`),
      // Codex's own approval off for hive: the fence is the PreToolUse hook (PR2), never this.
      ...config('mcp_servers.hive.default_tools_approval_mode="approve"'),
      ...config(hooks('Stop', hookCommand())),
      // The stop marker: a disabled server, so it is on the argv with no warning and no effect.
      ...config('mcp_servers.hive_wake.enabled=false'),
      ...config(`mcp_servers.hive_wake.command=${toml(id)}`),
      spec.prompt,
    ],
    addEnv: {},
    stripEnv: [...CODEX_SESSION_ENV_KEYS, ...(spec.subscriptionAuth ? CODEX_AUTH_ENV_KEYS : [])],
    defaultContainerCommand: 'codex',
    stopPattern: id,
    // A first wake's id is the marker's; the conversation's own comes from `thread.started`.
    namesConversation: !start,
  };
}

/** Refuses every rule set: no Codex run may start before the PreToolUse fence exists (PR2 of HIVE-342). */
export const codexFence: PermissionFence = {
  express: () => ({ ok: false, unexpressible: ['*'] }),
};
