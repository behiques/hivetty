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
`permission_prompt` is left out: `permissionRequest` already gives that signal.

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
