# Copilot interactive TUI: probe findings (HIVE-280)

Measured 27 Oct 2026 on a real `copilot` TUI driven by `probe.py` on a 40×120 pty, with a scratch
`COPILOT_HOME` holding a copy of `~/.copilot/config.json`, a `--plugin-dir` plugin subscribing every
event, and `HIVE_*`, `COPILOT_*`, `GH_TOKEN` and `GITHUB_TOKEN` stripped from the env.

**Version.** The first run (P1, approval) was on 1.0.104. Copilot updated itself to **1.0.105**
during that run ("Update: v1.0.105 · next launch"), so every later run was on 1.0.105. No
behaviour below differed between the two where both were seen (the approval run's hook bodies
match the later runs field for field).

Scrubbed: the home and the scratch dir are `/tmp/copilot-fixture`; session ids are
`11111111-2222-4333-8444-55555555555N`. The scratch home loaded the user's installed plugins
(`superpowers`), so some runs show a `skill` tool call first; those are left out of the fixtures.

## P0 (from the spec, already run)

A plugin dir holding `plugin.json` and `hooks/hooks.json` passed as `--plugin-dir` is listed under
"External Plugins (via --plugin-dir)"; its hooks fire in the interactive TUI (`sessionStart`,
`userPromptSubmitted`, `preToolUse`, `postToolUse`, `agentStop`); `sessionStart` fires at the first
prompt. Bodies carry `sessionId` (the pinned `--session-id`), `cwd`, `timestamp`, and
`toolName`/`toolArgs`/`toolResult`; `agentStop` carries `transcriptPath`
(`$COPILOT_HOME/session-state/<id>/events.jsonl`) and `stopReason`. Bodies name no event, so the
envelope wrap stays. The login lives outside the home. An untrusted folder shows "Confirm folder
trust" first (`1. Yes` trusts for the session only, so it shows again on every launch).

Re-confirmed here: the trusted-folders key in `config.json` is `trustedFolders`.

## P1: permissionRequest

**Answer.**
- A hook that prints nothing leaves Copilot's own prompt up: "Do you want to run this command?"
  with `1. Yes` / `2. No, and tell Copilot what to do differently (Esc to stop)`. Enter approves.
- Order on a shell call: `preToolUse` (bash) → `permissionRequest` → `notification`
  (`permission_prompt`) → on approval, `postToolUse` with the **same** `toolName` (`bash`) →
  `agentStop`.
- `permissionRequest` carries `toolName` and `toolInput` (not `toolArgs`), `hookName:
  "permissionRequest"` and `permissionSuggestions: []`.
- **File writes do not pair by name.** `permissionRequest.toolName` is the permission kind `edit`
  for every file tool, while `preToolUse`/`postToolUse` carry the real tool: `apply_patch` (GPT
  models), `create` and `edit` (Claude models). Only an `edit` tool's completion matches.
- **Denial (Esc) fires nothing after `permissionRequest`/`notification`**: no `postToolUse`, no
  `agentStop`. The TUI prints "Operation cancelled by user" and returns to the prompt. The next
  `userPromptSubmitted` is the next event.
- No `agentId`/`parentAgentId` was seen on any tool event (no subagent ran).

**Evidence.** `permission-request-bash.json`, `pre-tool-use-bash.json`, `post-tool-use-bash.json`,
`permission-request-edit.json` + `post-tool-use-apply-patch.json` (GPT, apply_patch),
`permission-request-create.json` + `post-tool-use-create.json` (claude-sonnet-5.5, create),
`notification-permission_prompt.json`, `agent-stop.json`, `session-start.json`,
`user-prompt-submitted.json`, `session-end.json`.

**Consequence.** The design holds for shell calls: the TUI prompt stays up, `permissionRequest`
raises the card, `postToolUse` with the same name clears it. Two cases leave the tracker blocked
until the next prompt: an approved file write whose tool is not literally `edit`, and any Esc
denial. Raised to the controller before Task 5.

## P2: notification

**Answer.** Two types fired, both already in Claude's shape (`hook_event_name: "Notification"`,
`notification_type`, `message`, `title`):
- `permission_prompt` ("Permission needed"), right after every `permissionRequest`.
- `elicitation_dialog` ("Information requested") when Copilot asked with `ask_user`. That question
  fired **no** `permissionRequest`; `preToolUse` (`ask_user`) came first and no `postToolUse` until
  answered.
No `agent_idle` fired.

**Evidence.** `notification-permission_prompt.json`, `notification-elicitation_dialog.json`,
`pre-tool-use-ask-user.json`.

Answered (a second run typed `blue` into the dialog): `postToolUse` (`ask_user`, `toolResult`
"User responded: blue") follows, then `agentStop`.

**Evidence.** also `post-tool-use-ask-user.json`.

**Consequence.** Claude's `Notification` vocabulary has no `elicitation_dialog`, so the session lane
reads that notification as Claude's `PermissionRequest` for `AskUserQuestion` (a question block),
and spells `ask_user`'s `postToolUse` as `AskUserQuestion` so the answer clears it.
`permission_prompt` was left out here as an echo of `permissionRequest`; HIVE-385 found it is the
only signal that a prompt was drawn, and reads the card off it (P12).

## P3: resume

**Answer.**
- Before the first prompt `session-state/<id>/` exists (`workspace.yaml`, `checkpoints/`, locks) but
  **`events.jsonl` does not**. It appears with the first prompt.
- `sessionStart.source` is `"resume"` on the relaunch, and also on the first prompt of a session
  whose id was launched once before without a prompt; `"new"` only for a never-seen id.
- The relaunch with the same `--session-id` remembered: asked "what word did I ask you to
  remember?", it answered PERSIMMON.
- A relaunch within seconds of a SIGKILL shows "Session in use … 1. Resume anyway / 2. Go back"
  (the killed process's `inuse.<pid>.lock` is still fresh). The user answers it in the terminal.

**Evidence.** `session-start-resume.json`.

**Consequence.** `hasTranscript` rule: "a session that never got a prompt has no transcript and
restarts fresh". The transcript is `session-state/<id>/events.jsonl`.

## P4: plan tool

**Answer.** Copilot keeps its todo list in a SQL table through the `sql` tool: `INSERT INTO todos
(id, title, description, status) …` and `UPDATE todos SET status = 'done' WHERE id = …`. A call
carries one statement, not the whole list, and status words are `pending`/`in_progress`/`done`.

**Evidence.** `post-tool-use-sql.json`.

**Consequence.** plan: out (follow-up). Rebuilding the list means parsing SQL across calls.

## P5: initial task

**Answer.** `-i 'reply with the single word ok'` starts the TUI and runs the turn with no typed
keys (after the trust dialog). `sessionStart.initialPrompt` and `userPromptSubmitted.prompt` both
carry it; `agentStop` follows as for a typed prompt.

**Evidence.** `session-start-task.json`.

**Consequence.** `-i` on a fresh start, as planned.

## P6: keys

**Answer.**
- `line one`, `ESC CR`, `line two`, `CR` submitted once, as `"line one\nline two"`.
- `$ echo hi` written in one write and submitted went to the model as a prompt (it fired
  `userPromptSubmitted` with `"$ echo hi"`); it did not run as a shell command.
- `copilot help config` and `copilot --help` name no setting for a shell shortcut: none.

**Evidence.** `user-prompt-submitted-multiline.json`.

**Consequence.** newline is `\x1b\r` in `input-profile.ts`.

## P7: user config beside ours

**Answer.** With a user `agentStop` hook in `$COPILOT_HOME/settings.json`, a user stdio MCP server
`probe-user` in `mcp-config.json`, plus `--plugin-dir` and `--additional-mcp-config` adding
`hive-probe`:
- the user's marker file was written;
- the plugin's `agentStop` fired too;
- `/mcp list` showed `hive-probe — connected` and `probe-user — connected`.

A server that never answers `initialize` (`command: "cat"`) holds the first prompt in a queue
("still waiting on mcp"), so the probe's servers are a minimal JSON-RPC stub.

**Evidence.** run log only (no hook body differs from P1's).

**Consequence.** D2 holds. The live suite's user server must answer `initialize`, not be `cat`.

## P8: flags

**Answer.** `--model <m> --reasoning-effort medium` was never refused at the CLI. For this
account, models the plan does not offer print `✗ Model "<m>" from --model flag is not available.
Using "gpt-5.6-terra" instead.` and the session starts on that one (claude-fable-5.1,
claude-fable-5, claude-opus-5.5, claude-opus-5, claude-opus-4.8, claude-opus-4.8-fast,
claude-sonnet-4.6, gpt-6.1-sol, gpt-6-sol, gpt-6-astra, gpt-5.6-sol, gpt-5.5, gpt-5.4,
gpt-5.4-mini, gpt-5-mini, gemini-4-argon, gemini-3.7-flash, grok-4.5). `kimi-k3` starts but prints
`✗ Reasoning effort "medium" is not supported for model "kimi-k3".` `auto` started with every
`COPILOT_EFFORTS` value.

**Evidence.** run logs only.

**Consequence.** No vocabulary model is refused; availability is per account and Copilot falls
back on its own, visibly.

## P9: declines and interrupts (HIVE-365)

The shell dialog offers two or three options depending on the command (`1. Yes` · [`2. Yes, and
approve … for this location`] · `No, and tell Copilot what to do differently (Esc to stop)`).

| Input | Record (`events.jsonl`) | Turn |
| --- | --- | --- |
| Esc on the dialog | `permission.completed` `cancelled`, `assistant.turn_end`, `abort` `reason:"user_initiated"` | ends, no hook (FINDINGS P1) |
| ↓ Enter on "No, and tell Copilot…" | nothing yet: a feedback box opens | — |
| …feedback typed + Enter | `denied-interactively`, `tool.execution_complete`, the turn goes on | continues |
| Esc Esc mid-turn (`esc esc interrupt`) | `assistant.turn_end`, `abort` `reason:"user_abort"` | ends |

**Consequence.** "No, and tell Copilot…" is not a cancel: the turn continues once the feedback is sent, so `answersBlock`'s `answered` is right for it. The shell prompt offers two or three options depending on the command. Esc Esc mid-turn ends through `recordAborted`.

Measured in the live suite: Esc Esc four seconds after the submit, before the reply began streaming, wrote no `abort`; the first Esc offered "Esc again to edit prompt" and the turn went on. Ten seconds in, mid-stream, it wrote `abort` and the turn ended.

## P10: HiveTTY's skills and the instructions dir (HIVE-362)

**Answer.**
- A `--plugin-dir` plugin's skill lists as `hive:<name>` only when its bare name collides with a personal skill. A repository skill hides it instead (below).
- Typed in the TUI, `/hive:<name>` loads the plugin's skill when the name collides with a personal skill.
- `COPILOT_CUSTOM_INSTRUCTIONS_DIRS=<dir>` loads `<dir>/instructions/*.instructions.md`. A `--plugin-dir`'s own instruction files are not sources.
- A slash-typed skill fires no hook. `events.jsonl` records only an internal `skill` event.

Three more facts came out of the live suite:
- Copilot's YAML is strict. It refused `review-pr-findings`, `ship` and `spec-deviation`, whose one-line descriptions held an unquoted `: `. Their descriptions are now `>-` folded blocks.
- A personal skill under the scratch `$COPILOT_HOME/skills`, or under `~/.agents/skills` with a scratch `HOME`, is not read. So the suite cannot stage a user-skill collision without writing to the real home.
- A repository `.github/skills/<name>` (`source: "project"`) **shadows** a plugin skill of the same name. The plugin's is not listed as `hive:<name>`; it disappears.

HIVE-382 probed the rest (`copilot --plugin-dir <p> skill list --json` in a scratch repo, 3 Nov 2026):
- `.agents/skills/<name>` and `.claude/skills/<name>` in the repository hide a plugin skill of the same name, as `.github/skills` does. A personal `~/.agents/skills/<name>` renames it `hive:<name>` instead.
- Copilot keys a skill on its frontmatter `name:`, not its folder. A plugin folder `x` named `hive-x` lists as `hive-x` beside a repository `x`.
- Typed with an argument after it, the TUI resolves only `/<plugin>:<name>`. With `name: hive:x`, `/hive:x` loads but `/hive:x now` answers `Unknown command`. With `name: hive-x`, `/hive-x now` is unknown too, and `/hive:hive-x now` loads.
- So the Copilot rendering names every skill `hive-<name>` (`namePrefix`) and types it `/hive:hive-<name>` (`typedPrefix`, `refPrefix`). No bare name is left to collide. `pnpm test:session:copilot` stages `zz-repo` in all three repository roots and types two of the probes with an argument.

**Evidence.** The live suite's `typed-form` and `skill-list` cases (`pnpm test:session:copilot`).

**Consequence.**
- `refPrefix` and `typedPrefix` are `/hive:`.
- The marker rule rides the instructions dir.
- The listing case pins that every rendered skill loads.
- A repo skill that shares a HiveTTY skill's name hides HiveTTY's.

## P11: done, the typed /exit, and markers (HIVE-362)

**Answer.**
- `--allow-tool 'hive(session_done)'` stops Copilot drawing the prompt for `/hive:done`. But **Copilot still fires `permissionRequest`**, `toolName: "hive/session_done"` (fixture `permission-request-hive-session-done.json`). HIVE-368 assumed the hook would be skipped too. `readCopilotHook` now drops a request on `COPILOT_SESSION_PREAPPROVED`.
- `postToolUse` names the same call `hive-session_done`.
- `/exit\r` written in one write (`EXIT_COMMAND`) closes Copilot by itself.
- A bare `📒 <ref>`, with the marker rule standing in the instructions, gets the model to call `hive-ledger_read` and act on the entry.

**Evidence.** The live suite's `done` and `marker` cases.

**Consequence.**
- `promptMarker` is Claude's.
- `contextDelivery` is `'prompt-marker'`.
- The launch's `--allow-tool` list is `COPILOT_SESSION_PREAPPROVED`. HIVE-383 filtered the hook by the same list; HIVE-385 deleted the filter, since an allowed call draws no prompt and so fires no `permission_prompt` (P12). A unit test reads every `--allow-tool` off a real launch line and checks each raises no card.

## P12: the user's own approvals (HIVE-383)

**Answer.** Every approval the user makes still fires `permissionRequest`, with no prompt drawn. The reader raises a card, and that card is cleared at tool-end: a needs-you flash per call.
- **Don't ask again in this repo**: option 2 on a plain command's prompt, "Yes, and don't ask again for `mkdir` in this repo". A shell redirect (`echo x > f`) gets only Yes and No. The approval is kept in `$COPILOT_HOME/permissions-config.json`, under `locations.<repo>.tool_approvals`. This file is the config allow-list. The next `mkdir` draws no prompt and still fires the hook.
- **`/allow-all`**: "Allow All for this session", with no confirmation. The next call draws no prompt and still fires the hook.
- **`defaultPermissionMode: "allow-all"`**: `copilot config` writes this to `$COPILOT_HOME/settings.json`, not `config.json`. A session starts in Allow All, draws no prompt, and still fires the hook.

**Evidence.** The live suite's three P12 cases: the prompts drawn in the pty log against the `session.blocked` count.

**Consequence.**
- A fixed list cannot see these approvals: they live in Copilot's own state, and two of them change mid-session. `COPILOT_SESSION_PREAPPROVED` stays HiveTTY's own launch list.
- **HIVE-385 probe (1.0.105, the three cases plus `done`)**: `permission_prompt` fires only for a prompt Copilot drew, 19 ms after its `permissionRequest`, carrying `sessionId`, `cwd`, `message` and `title` but no tool. None of the four approvals (repo, `/allow-all`, `defaultPermissionMode`, `--allow-tool`) sent one; `postToolUse` followed the request about 35 ms later.
- So `readCopilotHook` holds each session's `permissionRequest` and raises its card only when `permission_prompt` follows. A `postToolUse` or `agentStop` first forgets it. The three cases now expect no card for an approved call.

## P13: agentStop block (HIVE-370), copilot 1.0.105

`copilot -p 'Reply with the word hi.' --allow-all-tools --plugin-dir <probe>` in a scratch git repo, signed in
through the user's `gh` login, the probe plugin's one `agentStop` hook logging each payload and printing
`{"decision":"block","reason":"…reply PLUM<n>"}` until a counter reaches `PROBE_MAX`, then either
`{"decision":"allow"}` (copilot shape) or nothing (claude shape). (Numbered P13 because P10 to P12 were taken;
the plan's "FINDINGS P10" for Copilot means this section.)

| Probe | Result |
| --- | --- |
| `PROBE_MAX=2`, then `allow` | `hi`, `PLUM1`, `PLUM2`; the hook ran 3 times, `stop_hook_active` `false` then `true`, `stopReason: end_turn` on each. |
| `PROBE_MAX=20`, then `allow` | 9 runs, `PLUM8` last. **Cap of 8 consecutive blocks**: the ninth block is ignored and the turn ends. |
| `PROBE_MAX=0`, silence | `hi`, one run, the turn ends cleanly. |
| `PROBE_MAX=1`, then silence | `hi`, `PLUM1`, two runs: silence releases after a block too. |
| A subagent | Not re-driven: `hooks-1.0.104/agent-stop-subagent.json` already carries `agentId`, `agentType` and `parentAgentId` on a subagent's `agentStop`. |

**P13: Copilot honours the block.** `{"decision":"block","reason"}` on `agentStop` continues the turn with the
reason as the next prompt; `{"decision":"allow"}` and silence both release. Copilot stops honouring blocks after
8 in a row, the same as goal-on's default `turn_budget`. Measured under `-p`; the TUI case is HIVE-370's live test.
