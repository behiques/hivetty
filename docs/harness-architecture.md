# Harness architecture

A **harness** is the CLI that drives an agent session. HiveTTY speaks to it through a
port, so that Claude Code is the first adapter rather than an assumption spread through
main. Epic HIVE-232 is phase 1; HIVE-233 built the skeleton this doc describes, and each
later story fills in its section.

## Phase 1: no behaviour change

Phase 1 moves Claude-specific code behind the port without changing what it does. Claude
Code stays fully functional, exactly as before. Existing tests keep their assertions; a
test may move to mirror a moved file, and any changed assertion is called out in its PR
with why it is not a behaviour change.

## The pieces

| Piece | Path | What it is |
| --- | --- | --- |
| The contract | `electron/shared/harness-contract.ts` | `HarnessId` (`'claude-code'` only, for now) and `Capabilities`. Types only. |
| The port | `electron/main/harness/port.ts` | `HarnessAdapter`: `id`, `capabilities`, and the methods stories add. |
| The registry | `electron/main/harness/registry.ts` | `createHarnessRegistry({ isAgentSession })` → `{ adapterFor, harnessOf }`, and `sessionAdapter()` for the shared runtimes. |
| Adapter #1 | `electron/main/harness/claude-code/` | `claudeCodeAdapter`. |

### The port grows by story

| Method | Story |
| --- | --- |
| `launch` | HIVE-234 (landed) |
| `prepare` | HIVE-235 (landed) |
| `readHook`, `contextReply` | HIVE-236 (landed); HIVE-237 and HIVE-238 (landed) change what it says |
| `foldEdits` | HIVE-238 (landed) |
| `record`, `meters` | HIVE-239 (landed) |
| `promptMarker` | HIVE-240 (landed) |
| `installed` | HIVE-345: the user's own skills and plugins (`skillNames`, `pluginNames`, `sessionOverrides`), reached through `sessionAdapter()` by the agents runtime, the skills snapshot and the hook settings' `enabledPlugins`. |

### Capabilities: build one, shape for three

`Capabilities` is an interface; each field landed with the story whose core code reads it.
`resume: 'by-id' | 'none'` (HIVE-239) gates the spawn's `history.resumable` lookup;
`meters: boolean` (HIVE-239) gates the receiver's `/statusline` route (404 when false);
`contextDelivery: 'prompt-marker' | 'none'` (HIVE-240) gates `deliver.ts`'s write; `none` types
nothing and records no receipt.
No field is added for a harness that does not exist yet.

### launch

`launch(spec: LaunchSpec): LaunchPlan` (HIVE-234). Both types live on the port, beside
`ContainerSpawn`, so the core can build one and read the other without importing the
adapter.

- **`LaunchSpec` is what the core knows:** the configured `command` (`claudeCommand`,
  `{env}` placeholder and all), `model`, `effort`, `name`, `task`, `sessionUuid` plus
  `resume`, the three paths (`settingsPath`, `pluginDir`, `mcpConfig`),
  `subscriptionAuth`, and a `ContainerSpawn` for a container project.
- **`LaunchPlan` is what it gets back:** `command` for `bootstrap.arm` to type into the
  login shell, `stripEnv` for the spawn to remove from the pty environment, and
  `submitDelayMs` for the bootstrap's text-then-`\r` split (HIVE-63).

Claude Code's `launch` (`harness/claude-code/launch.ts`) wraps `sessionCommand`, which
moved there verbatim, and owns `SUBMIT_DELAY_MS`. `sessions/index.ts` makes the plan
**before** `startProcess`, so the spawn's `stripEnv` comes from it. Only pure resolution
(paths, the hook env, the container map, the session uuid) is hoisted above the spawn;
every side effect keeps its old place after it.

`shellQuote`, the `{env}` expansion (`container-command.ts`) and the host↔container path
map live in `electron/main/container/`, not `sessions/`: the adapter needs them, fence 2
forbids it `sessions/**`, and the headless agent waker uses them too.

### prepare

`prepare: HarnessFiles` (HIVE-235) is the files a harness needs on disk before it starts,
named by purpose: `sessionSettings`, `agentSettings`, `plugin`, `containerSet` and
`mcpConfig`. Claude Code's table points at the writers that moved into
`harness/claude-code/` with byte-identical output: `settings.ts` (session and agent
settings, the status line script), `plugin.ts` and `done-skill.ts`, `mcp-config.ts`
(the host stdio and container HTTP `--mcp-config` files), and `container-files.ts`
(what each file in a container set says).

- **The adapter owns what; the core owns when.** The shared runtimes (`hooks`, `skills`,
  `mcp`, `container/generated.ts`) reach the writers through `sessionAdapter()` in
  `harness/registry.ts`. They keep their own queues, memoisation and failure policy:
  the settings-rewrite queue, the plugin-prune chain, the MCP memo, the container-removal
  wait. These runtimes are app-wide, not per entity, so `harnessOf` has nothing to answer
  them with. Phase 1's `sessionAdapter()` is Claude Code.
- **One spawn-time sequence.** `prepareSession` in `ipc/index.ts` runs what `ptySpawn` and
  `ptyRestart` used to order by hand: `skills.sync()`, `hooks.rewriteSettings()`,
  `mcp.start()`, then for a spawn the container removal wait and the per-session container
  write. It returns `PreparedFiles` (`settingsPath`, `pluginDir`, `mcpConfig`; absent means
  no flag), which travels on `OpenRequest.files` into `spawn`. `spawn` no longer asks a
  runtime for a path. A restart leaves its container write to `restartOnce`, in the window
  after the old process exits.
- **`container/layout.ts` is a leaf.** It holds the container set's filenames and
  `ContainerOrigins`, re-exported from `generated.ts`. `generated.ts` imports the registry
  and the adapter's `container-files.ts` needs the filenames, so the names live where
  `registry → claude-code → container` cannot cycle back.
- **Not moved:** `PLUGIN_DIR` and `agents/**`, which only ever receive paths. The
  `~/.claude` readers moved behind `installed` with HIVE-345. The server descriptors (`hiveServerSpec`, `containerHiveServerSpec`) stay in `mcp/` because
  the agent path shares them.

### The registry

`harnessOf(entityId)` answers `'claude-code'` for an agent session and `undefined` for a
plain terminal or a command (story 102). Only the sessions closure knows which an entity
is: ids are minted by the renderer, so a prefix proves nothing. The fence below stops
`harness/**` from importing `sessions/**`, so the core passes the fact in as
`isAgentSession`. HIVE-234 made that the single source for the distinction, replacing
`terminalEntities` in `electron/main/sessions/index.ts`.

`sessions/index.ts` answers `isAgentSession` from a positive `agentSessions` set: `spawn`
adds the entity before its process starts, and `settleExit` removes it. A failed spawn
does not remove it, because a session whose spawn failed was never a terminal. A
terminal is `harnessOf(id) === undefined` and not a command, since `harnessOf` is
`undefined` for both. So the `ptySpawn`/`ptySpawnTerminal` split now means harness
session versus plain terminal.

`adapterFor(id)` indexes a `Record<HarnessId, HarnessAdapter>`, so a `HarnessId` with no
adapter is a compile error, not a runtime miss.

Outside `electron/main/harness/**` and the contract's `HarnessId` type, nothing names
`claude-code`.

## The hook body (HIVE-236)

The receiver (`electron/main/hooks/receiver.ts`) owns the socket: authentication, the body
cap, the routes, and which lane a hook is on. A hook from an entity session is on the
`session` lane; one from an agent's headless run is on the `agent` lane, decided before a
byte of the body is read.

`readHook({ lane, entityId, body, truncated })` turns a Claude body into an ordered list
of `HookEffect`s and calls nothing. The receiver dispatches them to its callbacks in that
order, and decides what a prompt means: a ledger marker, a ticket intent, the first-prompt
name. `contextReply` is the adapter's wrapper for a marker's context reply.

The session lane reads with `harnesses.adapterFor(harnesses.harnessOf(id))`, and falls back
to `sessionAdapter()` when `harnessOf` answers `undefined`. The agent lane always reads with
`sessionAdapter()`, whose `prepare.agentSettings` wrote its hooks. The Claude vocabulary
(the subscribed events, their mapping to `StatusSignal`, the notification types, the reply shape and the
curl command hooks) lives in `harness/claude-code/hook-vocabulary.ts`, behind fence 1.
The core reads `StatusSignal` (`@shared/harness-contract`): the tracker, the inbox, `/done` and the
`session:status` payload never see a Claude event name (HIVE-237).

The plan effect carries a `PlanUpdate { entityId, op, cwd? }` (`@shared/plan-contract`,
HIVE-238). `harness/claude-code/plan-ops.ts` reads Claude's task tools, plan mode and
plan-file writes into a `PlanOp` (`task-created`, `task-updated`, `task-deleted`,
`tasks-replaced`, `plan-proposed`, `plan-file-touched`), and a `Stop` becomes
`plan-file-reread`. The plans store applies ops and never sees a Claude tool name or field.
The changed-files reader keeps its incremental transcript read and hands the lines to
`adapter.foldEdits`, which owns the transcript's format.

### record and meters

`record: HarnessRecord` (HIVE-239) is where a harness keeps a conversation: `transcriptPath(cwd, uuid)`,
`hasTranscript(cwd, uuid)` (the history's `--resume` check, through `sessionAdapter()` because history rows
carry no harness), `titleOrigin(cwd, uuid, name)` (rename or the harness's own guess) and `nameFromTitle(title)`
(the harness's reading of an OSC title; the scanner in `sessions/title.ts` stays generic and takes it as an
argument, since `harness/**` may not import `sessions/**`). `meters(body)` reads a status-line body into the
neutral `SessionMetrics`. Claude Code's live in `claude-code/{record,title-origin,title,metrics}.ts`.

## Context delivery (HIVE-240)

- ***When* is shared:** `electron/main/ledger/deliver.ts` decides it: idle, the empty-prompt
  read, the HIVE-135 draft hold, and receipts written only for a write that landed.
- ***What* is the adapter's:** `promptMarker(entry)`. Claude's is `📒 <ref>\r`, in
  `claude-code/prompt-marker.ts`.
- **The other half is the receiver:** `parseLedgerMarker` and `markerContext` stay shared, and the
  adapter only wraps the reply (`contextReply`).
- `deliver` reaches the adapter through `Sessions.adapterOf`, which falls back to `sessionAdapter()`
  for an entity no harness drives. An adapter that is absent (the session layer is not up) or
  declares `none` gets nothing typed and no receipt, so the next idle or ready transition asks again.

## Input profile (renderer, HIVE-240)

- `src/lib/harness/input-profile.ts` holds `InputProfile { newline, lineKill, lineMotion,
  claimsBareBack }`, `DEFAULT_INPUT_PROFILE` (today's keymap values: `NEWLINE_SEQUENCE`,
  `LINE_KILL_SEQUENCE`, `LINE_MOTION_SEQUENCE`, `claimBareBack`) and `inputProfileFor(harness)`.
- `Session.harness` is stamped where the store mints a session: a spawn, a `/clear` successor and
  history hydration.
- The profile flows `inputProfileOf(id)` (`src/lib/terminal/resolve-transport.ts`) → `center-stage`
  → the `TerminalHost` entry → `TerminalSurface`'s `inputProfile` prop. The store's
  `sendToSession` takes it too, for the line break inside a sent message.
- The surface still imports no store. It holds the prop in a ref, read per keystroke and per prompt
  read, so the key handler installed once never pins a stale profile.

## The port as built

- `launch(spec): LaunchPlan`.
- `headless.launch(spec): HeadlessPlan` — an agent run's argv, the env it adds and strips, the container's default binary and the `pkill -f` stop pattern (HIVE-337). `agents/waker.ts` keeps the prompt, the path map, the env filter and the `HIVE_*` identity.
- `headless.reader(): RunEventReader` — one run's stdout read into `RunEvent`s: the conversation id, MCP status, what the agent says, its tool calls, and the end with its stop, cost, turns and usage (HIVE-338). `agents/run-log.ts` folds events into run lines; `agents/runs.ts` decides the outcome from `end.stop`. Capabilities `reportsCostUsd`, `enforcesTurns`, `enforcesBudget` and `reportsMcpStatus` say which of those a CLI reports. Capability `agentMcp` lists the `mcp:` integrations a headless run on the CLI can be given (HIVE-340); an agent naming one it lacks does not resolve to it.
- `headless.fence: PermissionFence` — the permission fence (not the import fences below).
  `express(rules)` answers whether this CLI can route every call the rules do not allow to
  `decide()` in `@shared/permission-rules`, the one decision MCP `approve` and the receiver both
  make; `{ ok: false, unexpressible }` blocks the CLI for that run (HIVE-339). Claude's is total:
  its fence is `approve`. Resolution asks it (HIVE-340): `resolve-harness.ts` calls
  `fence.express` on the full `HIVE_GRANTS` list, and a CLI that cannot express a rule is skipped,
  never run unfenced.
- `HarnessGate` (`agents/resolve-harness.ts`) is what the licence and Settings › CLIs say about a
  CLI. It is wired as `createCliGate(getConfig)` (`agents/cli-gate.ts`, HIVE-341): `enabled`,
  `defaultCli` and `defaults` (the card's model, effort and Codex's sandbox; on Claude under
  `AGENT.md`'s model and effort, which are Claude's vocabulary and never reach another CLI) read the config
  per call, and `entitled` allows every CLI until HIVE-332. A new CLI adds its models and efforts
  as a row of `CLI_VOCAB` in `@shared/cli-contract`, which the config parser, the IPC guard and
  the card all read.
- `prepare: HarnessFiles`, a property reached through `sessionAdapter()`, whose result travels as
  `PreparedFiles` on `OpenRequest.files`.
- `readHook(input): HookReading`, `contextReply(text)`, `promptMarker(entry)`,
  `foldEdits(tallies, lines)` and `meters(body)`.
- `record: { transcriptPath, hasTranscript, titleOrigin, nameFromTitle }`.
- `capabilities: { resume, meters, contextDelivery }`.

## Codex (headless, HIVE-342)

Adapter #2 lives in `electron/main/harness/codex/` and is headless only: every interactive member
refuses with "codex has no interactive sessions yet (HIVE-279)", `record` answers `null`/`false`/
`'unknown'`, `installed` answers `[]`/`{}`, and `sessionAdapter()` and `harnessOf` stay Claude, so
nothing interactive reaches the refusals. Measured against `codex-cli 0.164.0`; the recorded
output and hook payloads are in `tests/fixtures/codex/`.

**The argv** (`codex/headless.ts`), flag by flag:

- `exec`, or `exec resume <thread_id>` on a later wake.
- `--json`: one event per line; `thread.started` is the first, before any tool can run.
- `--skip-git-repo-check`: an agent's workdir is not a repo, and `exec` refuses outside one.
- `--ignore-user-config`: the user's `config.toml` (plugins, MCP servers, profiles, hooks) never
  reaches an agent. Auth still comes from `CODEX_HOME`, which is never moved. This is the
  `--strict-mcp-config` analogue: **a Codex agent sees exactly one MCP server, `hive`**, and
  nothing the user configured for themselves.
- `--dangerously-bypass-hook-trust`: hooks given through `-c` fire only with it. It trusts only
  HiveTTY's own hooks, because every hook on the run is this argv's (user config is ignored), and
  nothing is ever written into `~/.codex`. Codex prints a warning `error` item per run for it; the
  reader drops it.
- `-m <model>` and `-c model_reasoning_effort="…"` from the Codex card, omitted when it names none.
- `-c sandbox_mode="…"`: `resume` has no `-s`, so both shapes use `-c`. **The sandbox defaults to
  `workspace-write`** when the card sets none; `danger-full-access` is never offered.
- `-c developer_instructions=…`, the system prompt, on a first wake only: a resumed thread keeps
  it. Every `-c` value is `JSON.stringify` output, a valid TOML basic string, with DEL escaped and
  lone surrogates replaced, the two strings JSON writes that TOML refuses.
- `-c mcp_servers.hive.{command,args,env}` and `env_vars=[…]`: the stdio hive host, its identity
  forwarded **by name** from the run's environment, so no token lands on the argv.
  `default_tools_approval_mode="approve"` turns Codex's own approval off for `hive`: the fence is
  the `PreToolUse` hook below, never this.
- `-c hooks.Stop=[…]`: a `curl` to `$HIVE_RECEIVER_URL/hook` with the session and token headers
  read from the run's environment, as the container transport does. Codex's payloads are
  Claude-shaped, so the agent lane reads them unchanged.
- `-c hooks.PreToolUse=[{matcher="*",…}]`: **the fence**, below.
- **The stop marker:** `-c mcp_servers.hive_wake.enabled=false -c mcp_servers.hive_wake.command="<id>"`.
  A disabled server is on the argv with no warning and no effect, so `pkill -f <id>` finds the
  run. `<id>` is the minted uuid on a first wake and the thread id on a resume.

`stripEnv` removes the eight `CODEX_*` keys a parent Codex session exports, and `OPENAI_API_KEY`
and `CODEX_API_KEY` under subscription auth. `CODEX_HOME` passes.

**`namesConversation`** (`HeadlessPlan`): whether the argv names the conversation. Claude's always
does. A first Codex wake's does not (its id is only the stop marker), so the tracker persists a
first Codex wake's conversation only from `thread.started`, and a run killed before that line
persists nothing rather than a uuid `resume` would fail on.

**Resolution:** `codex` is resolved on `PATH` with the same lookup as `claude` until HIVE-332 adds
its setting. **Containers are refused** for Codex: the container's hive server is the HTTP
descriptor, and the image has no signed-in `codex`. A sandbox outside `HEADLESS_SANDBOXES`
(`read-only`, `workspace-write`) is refused at the argv too, not only where the setting is read.

**The fence** (`codex/fence.ts`, the receiver's `POST /fence`). Codex has no permission-prompt
tool, so the fence is a `PreToolUse` hook on every tool call (`matcher="*"`, probed at 0.164.0 to
fire for `Bash`, `apply_patch` and MCP calls, and its deny to block each):

1. `fenceCommand()` POSTs the payload to `$HIVE_RECEIVER_URL/fence` with the session, token, run
   and run-token headers read from the env. **It fails closed**: a non-2xx, a timeout (30 s), an
   unreachable receiver or an empty reply prints a deny, never the empty output Codex would run.
2. The route authenticates as `/mcp` does and is the agent lane's alone (a pty session is `403`).
   A body over `FENCE_MAX_BODY_BYTES` (1 MiB) is denied, never checked by half.
3. `codexFence.translate` turns the call into Claude's vocabulary so `decide` stays the only
   matcher: `Bash` and `mcp__<server>__<tool>` pass through; an `apply_patch` becomes one `Write`
   (add, delete) or `Edit` (update, move target) per file, a relative path joined to `cwd` and
   never normalised, so `decide` refuses a `..` walk-up as it does for Claude. A patch the reader
   cannot read whole (an unknown `***` line, a control or line-separator character in a path, a
   `Move to` with no file, anything after `*** End Patch`, a relative `cwd`) is asked about as the
   raw `apply_patch` call: a header skipped there would be a file written unchecked.
4. Each translated call goes through `approve`, in order: `decide` allows, denies without posting,
   or posts the one permission ask and denies. The reply is Codex's hook JSON: `{}` to run, or a
   `permissionDecision: "deny"` carrying the reason.

`CODEX_RULE_TABLE` files every rule shape under `expressed` (`*`, `Bash`, `Bash(<glob>)`, `Write`,
`Edit` and their globs, MCP names and wildcards, their `literal:` forms) or `neverProduced`
(`Read`, `Glob`, `Grep`, `WebFetch`, `NotebookEdit`, `Task`, `Agent`, their globs and literals):
Codex reads and searches through the shell, so a rule naming those allows nothing and widens
nothing. The fence is total: `express` accepts every rule set.

Interactive: HIVE-279. Meters: HIVE-334. Plans: HIVE-352. Containers: refused.

## Copilot (headless, HIVE-343)

Adapter #3 lives in `electron/main/harness/copilot/` and is headless only, shaped as Codex's is:
every interactive member refuses with "copilot has no interactive sessions yet (HIVE-280)".
Measured against `GitHub Copilot CLI 1.0.104-4`; the recorded hook bodies, a usage file and a
refused token's stderr are in `tests/fixtures/copilot/`; the `preToolUse` bodies for every tool
the fence translates are in `tests/fixtures/copilot/hooks-1.0.104/`.

**The argv** (`copilot/headless.ts`), flag by flag:

- `-p <prompt> -s`: one non-interactive turn; under `-s` stdout is the answer and nothing else.
- `--no-ask-user`: no `ask_user` tool, so a run never waits on a person it cannot reach.
- `--disable-builtin-mcps`: drops github-mcp-server, so the only MCP server is `hive`.
- `--session-id <uuid>` on every wake: it resumes the session when it exists and starts one under
  that id when it does not (probed), so a first wake that died before Copilot made its session is
  resumed cleanly. The id is pinned, so `namesConversation` is true and the uuid is the stop marker.
- `--model` and `--reasoning-effort` from the Copilot card, omitted when it names none.
- `--allow-tool shell`, `write` and `hive`: Copilot's own layer must allow a kind before a call can
  run at all, and the `preToolUse` hook decides each call. A hook's allow grants nothing. Never
  `--allow-all*` or `--yolo`.
- `--deny-tool <pattern>` per card pattern, last among the permission flags; a deny wins over
  every grant.
- `--additional-mcp-config <json>`: the stdio hive host, its identity forwarded **by reference**
  (`"HIVE_HOOK_TOKEN": "${HIVE_HOOK_TOKEN}"`), which Copilot expands from the run's env, so no
  value lands on the argv.
- `--secret-env-vars COPILOT_GITHUB_TOKEN`: Copilot redacts the token from its own output too.
- `--usage-output-file <home>/usage/<uuid>.json`, read once the run exits (below).
- Never `--no-auto-update`: it makes the loader run the executable's bundled build, older than the
  user's own `copilot`.

**Isolation is `COPILOT_HOME`**, set to the app-owned `~/.hivetty/cli/copilot` and shared by every
Copilot run so `--session-id` finds its session. Config, `settings.json`, `session-state/`, logs and
plugin data land there; the user's `~/.copilot` (plugins, MCP servers, hooks, login) never reaches
an agent, and HiveTTY never writes there. The package cache and managed settings stay in
`~/Library/Caches/copilot`, shared with the user's CLI. `stripEnv` removes the six `COPILOT_*` keys
a parent Copilot session exports; `GH_TOKEN`, `GITHUB_TOKEN` and `COPILOT_ALLOW_ALL`, which
would outrank or widen the stored token; and `COPILOT_ROUTING_ENV_KEYS` (the `COPILOT_PROVIDER_*`
BYOK keys, `COPILOT_OFFLINE`, `COPILOT_MODEL`, `COPILOT_AUTO_TIER`, `COPILOT_ASSISTED_APPROVAL`,
`GH_ENTERPRISE_TOKEN`), which would change who pays, which model answers or what is approved.
`GH_HOST` and `COPILOT_GH_HOST` stay, for an Enterprise user's stored token.

**Two hooks**, in the home's `settings.json` (the same bytes for every run; identity comes from the
env), which fire under `-p` on a start and on a resume with no folder trust:

- `agentStop` → `/hook`, arming the stall watchdog. Copilot's bodies name no event, so the `sh`
  command wraps each as `{"event":"agentStop","payload":…}` and sends `x-hive-harness: copilot`;
  the receiver's `readerFor` picks the adapter by that header, and `readCopilotHook` reads the
  envelope as Claude's `Stop`. **A subagent's `agentStop` (`agentId` set) never arms it**: a `task`
  subagent fires its own mid-turn (probed), and the parent is still working.
- `preToolUse` → `/fence`, failing closed exactly as Codex's does, with a 35 s hook timeout over
  curl's 30 s so the hook's deny is what Copilot sees.

Only two because only these act: tool events for the plan panel are HIVE-352's, as for Codex. The
commands are `hook-commands.ts`, shared with Codex.

**Files the core writes** (`HeadlessPlan.files`): `<home>/settings.json` and `AGENTS.md` in the
lane's workdir, each only when its bytes differ, so two Copilot wakes never rewrite a file under
each other. **`AGENTS.md` is the system prompt**: Copilot reads it from the cwd, and a resumed
session re-reads a changed one (probed).

**The token.** `cli-tokens.ts` holds it as Slack's are held: `safeStorage`-encrypted in
`userData/cli-tokens.bin`, set and cleared through `cli:set-token` and `cli:clear-token`, every
answer presence only (`CliTokensState`); `read()` has no channel. A wake gets it as
`COPILOT_GITHUB_TOKEN` on the child's env, written after the strip, and nowhere else: never in
`config.json`, on the argv or in a log line. No stored token refuses the run: "copilot cannot
start: no Copilot token: add one in Settings › CLIs".

**`finish()` and the usage file.** `RunEventReader.finish(exit, stderrTail)` runs after the exit
flush, for what only the exit can tell. Copilot's reads `tokenDetails` from the usage file into
`RunUsage` and **deletes the file**, so a later wake that dies before writing one never reports this
one's. The tracker holds the run's lane until `finish` settles, bounds it at `FINISH_WINDOW_MS`
(5 s), and settles a run it ended itself (killed, stalled, quit) at once, so `closeAll` still
finalizes every run before its caller flushes state. Claude and Codex have no `finish`; their close
stays synchronous.

**Failures** (`classifyFailure`, over the last 4 KiB of stderr): a refused token (Copilot's own
"Authentication token found but could not be validated", "Bad credentials" or "PAT user login
(401)"; a bare 401 is any server's, so it is not one) reads "the Copilot token was refused: replace it in Settings ›
CLIs". A missing subscription and an org-disabled CLI have their own lines, but their patterns are
**unverified**: no account could produce them, so they are upgraded from the first real failure's
text. Anything else is stderr's last line, else the exit.

**Settings › CLIs** gives the Copilot card a write-only Token field and a Deny patterns list
(`kind(argument)`, at most 50, each a `--deny-tool`). **Containers are refused**, as for Codex.

**The fence** (`copilot/fence.ts`, the receiver's `POST /fence`), Codex's in all but its reader:

1. The `preToolUse` command is the shared `fenceCommand` with `x-hive-harness: copilot`, so
   `handleFence` picks `copilotFence` by header (a header naming a CLI with no fence is `400`). It
   **fails closed** as Codex's does: `curl -sf` turns a non-2xx, a timeout, a down receiver or an
   empty reply into `FENCE_DOWN`, a `permissionDecision: "deny"`.
2. `readCopilotFence` takes `toolName`, `toolArgs` (a JSON string, parsed; one that does not parse
   is `400`) and `cwd`.
3. `translateCopilotCall` maps only names a probe recorded: `bash` → `Bash`, `create` → `Write`,
   `edit` → `Edit`, `view` → `Read` (a relative path joined to an absolute `cwd`, never
   normalised), `glob` → `Glob`, `grep` → `Grep`, `web_fetch` → `WebFetch`, `task` → `Task`,
   `tool_search_tool` → `ToolSearch` (Copilot's deferred-tool search, recorded by the live suite:
   without it a standing run ends asking on the standing `ToolSearch` grant), and `hive-<tool>` →
   `mcp__hive__<tool>`. Anything else **passes raw**, so `decide` meets a name it does not know and
   asks: a relative path with no absolute `cwd`, and a `hive-x-y` name (a hive tool holds no `-`,
   so that is another server's).
4. `approve` decides as for Claude and Codex. The reply is Copilot's: `{}` leaves the call to
   `--allow-tool`, or a deny carrying the reason. A hook's allow grants nothing, and a card's
   `--deny-tool` pattern wins over a granted call.

`COPILOT_RULE_TABLE` files every rule shape under `expressed` (`*`, `Bash`, `Write`, `Edit`,
`Read` and their globs, `Glob`, `Grep`, `WebFetch` and `WebFetch(domain:…)`, `Task`, `ToolSearch`,
MCP names and wildcards, their `literal:` forms) or `neverProduced` (`NotebookEdit`, `Agent`):
Copilot makes no call by those names, so a rule naming them allows nothing and widens nothing. The
fence is total: `express` accepts every rule set.

Interactive: HIVE-280. Meters: HIVE-335. Plans: HIVE-352. Containers: refused.

## The fences

Both are `import/no-restricted-paths` zones in `eslint.config.mjs`, and
`pnpm verify:boundaries` plants a violation for each.

1. **The driven side stays sealed.** Nothing outside `electron/main/harness/**` may import
   `electron/main/harness/claude-code/**`, `electron/main/harness/codex/**` or
   `electron/main/harness/copilot/**`. Everyone else goes
   through the registry.
2. **Adapters don't reach the core.** `electron/main/harness/**` may not import
   `electron/main/{sessions,ipc,notifications,plans}/**`. The core passes what an adapter
   needs in as arguments.

## Adding a second harness

The checklist, member by member, with the live suite that proves each:

- [ ] A `HarnessId` member in `electron/shared/harness-contract.ts`.
- [ ] An adapter in `electron/main/harness/<id>/`, registered in `registry.ts` (`adapters` is a
  `Record<HarnessId, …>`, so a missing one fails to compile).
- [ ] `launch` (`test:pty` for the spawn, `test:ready` for boot).
- [ ] `headless.launch` (`test:agent`).
- [ ] `headless.reader` (`test:agent`).
- [ ] `headless.fence` (`test:agent`'s fence case for Claude; HIVE-342/343's suites prove an ungranted shell command, file write and MCP call each ask).
- [ ] `prepare` (`test:hooks`, `test:skills`, `test:mcp-http`, `test:container`).
- [ ] `readHook` (`test:hooks`, `test:plan`, `test:done`).
- [ ] `contextReply` (`test:hook-context`).
- [ ] `promptMarker`, if `contextDelivery: 'prompt-marker'` (`test:marker`, `test:nudge`).
- [ ] `foldEdits` (unit; transcript fixtures).
- [ ] `meters`, if `meters: true` (`test:statusline`).
- [ ] `record` (`test:title`, plus `test:back` for resume, if `resume: 'by-id'`).
- [ ] An `InputProfile` in `PROFILES` in `src/lib/harness/input-profile.ts`, keyed by `HarnessId`,
  so a missing one fails to compile (`test:back` for `claimsBareBack`; `test:pty` for the bytes).
- [ ] Stamp the new `harness` where the store mints that kind of session.
- [ ] Re-run the Epic grep.

The wiring, in order:

1. Add its id to `HarnessId` in `electron/shared/harness-contract.ts`.
2. Add `electron/main/harness/<id>/index.ts` exporting a `HarnessAdapter`.
3. Add it to the registry's `adapters` table (the compiler insists).
4. Add its folder to fence 1's `from` in `eslint.config.mjs`, and a planted case to
   `scripts/verify-boundaries.mjs`.
5. Teach `harnessOf` how the core says which harness an entity runs. Phase 1 answers
   `'claude-code'` for every agent session.
6. Implement `prepare`: a `HarnessFiles` table writing the files the harness reads at
   launch. `sessionAdapter()` decides which adapter the shared runtimes write for.
