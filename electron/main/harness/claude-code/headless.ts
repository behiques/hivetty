import { AUTH_ENV_KEYS } from '@shared/config-contract';
import { HIVE_CONSENT_TOOLS } from '@shared/ledger-tools';
import { namesTool, ONCE_ONLY_TOOLS } from '@shared/permission-rules';

import type { HeadlessPlan, HeadlessSpec, PermissionFence } from '../port';

/**
 * The command line one agent wake runs, in Claude Code's spelling (HIVE-115, HIVE-337).
 *
 * Pure on purpose: no spawn, no disk. `agents/waker.ts` owns what the agent is
 * told and where its files are; this owns how `claude -p` is asked to do it.
 *
 * ## Why `--setting-sources ""`
 *
 * Without it the run loads the user's own `~/.claude/settings.json`. On a
 * developer machine that routinely carries `permissions.defaultMode: "auto"`,
 * which would auto-approve every tool an unattended agent asked for, and would
 * fire the user's personal hooks inside the agent's turn. Verified that
 * `--settings` still applies alongside it, so the Hive's own hooks — the ones
 * that close a run — keep firing.
 *
 * ## Why `--allowedTools` is a grant and not a fence
 *
 * Measured at 2.1.251: the flag is additive. Asked for Bash with
 * `--allowedTools "Read"`, the model used Bash — with or without
 * `--setting-sources ""`, and under `--permission-mode dontAsk` too. There is
 * no default-deny in `-p`. `def.tools` therefore *grants*; confinement is
 * HIVE-119's permission-prompt tool, which is the mechanism built for it.
 */

/**
 * Every subagent an agent dispatches runs in the foreground.
 *
 * Measured at 2.1.269: under `-p` the model picks foreground or background per
 * `Agent` call, and a background subagent never calls
 * `--permission-prompt-tool`. Behind `permissions.ask: ["*"]` every one of its
 * calls is denied on the spot, granted tool or not, with no ask on the ledger.
 * That is how acr's reviewers lost every tool, eight in a row. Foreground
 * subagents route through `mcp__hive__approve` like the agent itself.
 *
 * It also turns off background Bash, which a headless turn cannot wait on.
 */
const FOREGROUND_ONLY = { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' };

/**
 * The grants less anything that would grant a once-only tool (retro B).
 *
 * The CLI grants what `--allowedTools` names without consulting the fence, so
 * a definition naming `project_auto_merge`, `mcp__hive__*` / `mcp__hive`, or
 * the blanket `*` would merge unattended with nobody asked. A rule that names
 * one is dropped, and a wide one is replaced by the consent tools it named:
 * every other hive tool is already in `HIVE_STANDING_GRANTS`.
 *
 * `--allowedTools` only. `HIVE_GRANTS` takes `def.tools` as written, because
 * the fence's `matches` refuses a once-only tool to every rule but a one-shot
 * literal; narrowing it too would leave a `*` agent asking about every `Bash`
 * call once the blanket left the argv.
 */
function grantableTools(tools: readonly string[]): string[] {
  const onceOnly = [...ONCE_ONLY_TOOLS];
  return tools.flatMap((rule) =>
    onceOnly.some((tool) => namesTool(rule, tool))
      ? HIVE_CONSENT_TOOLS.filter((tool) => !ONCE_ONLY_TOOLS.has(tool) && namesTool(rule, tool))
      : [rule],
  );
}

export function launchHeadless(spec: HeadlessSpec): HeadlessPlan {
  const { conversation, files, limits } = spec;
  const id = 'start' in conversation ? conversation.start : conversation.resume;

  return {
    args: [
      '-p',
      ...('start' in conversation ? ['--session-id', id] : ['--resume', id]),
      '--name',
      spec.name,
      ...(spec.model === undefined ? [] : ['--model', spec.model]),
      ...(spec.effort === undefined ? [] : ['--effort', spec.effort]),
      '--settings',
      files.settings,
      // The isolation flag. See the module comment.
      '--setting-sources',
      '',
      '--plugin-dir',
      files.pluginDir,
      '--mcp-config',
      files.mcpConfig,
      '--strict-mcp-config',
      '--allowedTools',
      grantableTools(spec.grants).join(','),
      /*
        The fence (HIVE-119). `--allowedTools` above is a grant and cannot deny;
        what actually stops an ungranted call is the `permissions.ask: ["*"]` rule
        in the agent settings file, which routes every call here. Measured: the
        flag is hidden from `--help` but real, and does nothing without that rule.

        Never add `--permission-mode`: `dontAsk` skips this tool and auto-denies.
      */
      '--permission-prompt-tool',
      'mcp__hive__approve',
      '--max-turns',
      String(limits.turns),
      ...(limits.budgetUsd === undefined ? [] : ['--max-budget-usd', String(limits.budgetUsd)]),
      '--append-system-prompt-file',
      files.systemPrompt,
      '--output-format',
      'stream-json',
      '--verbose',
      spec.prompt,
    ],
    addEnv: FOREGROUND_ONLY,
    /*
      Deletion, not a shell `unset` prefix.

      `bootstrap.ts` prefixes `unset …` because a session runs inside a login
      shell that re-sources the user's rc files and could export the key again.
      There is no shell here, so the key simply never exists.
    */
    stripEnv: spec.subscriptionAuth ? AUTH_ENV_KEYS : [],
    // On the argv of every wake and unique per run, so it stops only this one (HIVE-137).
    stopPattern: id,
    // `--session-id` or `--resume` names it on every wake (HIVE-342).
    namesConversation: true,
  };
}

/**
 * Total, by construction (HIVE-339). Claude's fence is `approve` itself: `permissions.ask: ["*"]`
 * routes every call to it and it runs `decide`, so every rule the grammar has is enforced as
 * written, and one `matches` refuses is narrower, never wider.
 *
 * `ToolSearch` is granted on every wake (HIVE-344), found by a live run rather than a unit test. MCP
 * tool schemas are deferred: the model sees `mcp__hive__ledger_read` by name but must call the
 * built-in `ToolSearch` to fetch the schema. No `def.tools` names a built-in, so without this the
 * fence denies the first thing the preamble asks for. It grants no capability: every tool it
 * surfaces is still fenced when called.
 */
export const claudeFence: PermissionFence = { express: () => ({ ok: true }), grants: ['ToolSearch'] };
