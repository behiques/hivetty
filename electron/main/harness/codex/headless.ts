import { HEADLESS_SANDBOXES } from '@shared/cli-contract';
import {
  HOOK_ENV_GRANTS,
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_RUN,
  HOOK_ENV_RUN_TOKEN,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
} from '@shared/hook-contract';

import { fenceCommand as sharedFenceCommand, hookCommand } from '../hook-commands';
import type { HeadlessPlan, HeadlessSpec } from '../port';

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

/** Half a surrogate pair: JSON escapes it, but TOML holds Unicode scalar values only. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * A TOML basic string. JSON's escapes are a subset of TOML's, so `JSON.stringify` is one, apart
 * from the two strings it writes that TOML refuses: a raw DEL, and an escaped lone surrogate.
 */
export const toml = (value: string): string =>
  JSON.stringify(value.replace(LONE_SURROGATE, '�')).replace(/\u007f/g, '\\u007f');
const tomlList = (values: readonly string[]): string => `[${values.map(toml).join(',')}]`;
const tomlTable = (record: Record<string, string>): string =>
  `{${Object.entries(record)
    .map(([key, value]) => `${toml(key)}=${toml(value)}`)
    .join(',')}}`;

/** What the fence hook prints when it cannot get an answer: codex stops the call. */
const FENCE_DOWN = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'HiveTTY could not be reached to check this call, so it was not run. End your turn.',
  },
});

/**
 * The fence (HIVE-342): every tool call's `PreToolUse` goes to the receiver's `/fence`, which
 * answers as `approve` does. Fails closed: a receiver that is down, slow, refusing or silent gives
 * a deny, never the empty reply codex would run. The identity and run come from the env by name.
 */
export const fenceCommand = (): string => sharedFenceCommand({ denyJson: FENCE_DOWN });

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

  /*
    Checked here as well as where the setting is read: this is the last place before the argv,
    and `danger-full-access` (or anything else codex accepts) must not arrive by a forged spec.
  */
  const sandbox = spec.sandbox ?? 'workspace-write';
  if (!(HEADLESS_SANDBOXES as readonly string[]).includes(sandbox)) {
    throw new Error(`codex: refusing sandbox ${JSON.stringify(sandbox)}; only ${HEADLESS_SANDBOXES.join(', ')} are allowed.`);
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
      ...config(`sandbox_mode=${toml(sandbox)}`),
      ...(start ? config(`developer_instructions=${toml(spec.instructions)}`) : []),
      ...config(`mcp_servers.hive.command=${toml(hiveServer.command)}`),
      ...config(`mcp_servers.hive.args=${tomlList(hiveServer.args)}`),
      // On the argv as written: `hiveServer.env` must never carry a secret, which goes by name below.
      ...config(`mcp_servers.hive.env=${tomlTable(hiveServer.env)}`),
      ...config(`mcp_servers.hive.env_vars=${tomlList(HIVE_SERVER_ENV)}`),
      // Codex's own approval off for hive: the fence is the PreToolUse hook below, never this.
      ...config('mcp_servers.hive.default_tools_approval_mode="approve"'),
      ...config(hooks('Stop', hookCommand())),
      ...config(hooks('PreToolUse', fenceCommand(), '*')),
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
