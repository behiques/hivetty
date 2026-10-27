# Codex 0.164 interactive TUI: findings (HIVE-279)

Measured on 2026-10-27 with a real, signed-in `codex-cli 0.164.0` on a 120x40 pty, by `probe.py`
in this directory. Every run had its own scratch git repo (trusted in the scratch `config.toml`, as
a user's own repo is) and its own `CODEX_HOME` holding a copy of `auth.json`. The spec's numbering.

The driver has to give the pty a size and answer the TUI's start-up queries (`ESC[6n`, OSC 10/11,
`ESC[?u`, `ESC[c`), as xterm.js does in a session pane; without either the TUI draws nothing.

## P1: do `-c hooks.<E>` hooks fire in the TUI?

**With `--dangerously-bypass-hook-trust`: yes.** `SessionStart`, `UserPromptSubmit`,
`PermissionRequest`, `PostToolUse` (`matcher="update_plan"` in the probe; the product hooks `matcher="*"`, HIVE-279) and `Stop` all reached the probe's
server (`--bypass --plan-flag --ask`).

**Without it: no.** The TUI opens on a "Hooks need review: 5 hooks are new or changed" dialog
(review / trust all / continue without trusting). Nothing fires until it is answered, and the typed
task is swallowed by the dialog's menu. Trusting writes `[hooks.state."/<session-flags>/config.toml:<event>:0:0"]
trusted_hash = …` into `$CODEX_HOME/config.toml` (codex's write, on the user's choice). `hookCommand()`
reads its identity from the env, so its text is the same on every launch, and so (reasoned, not
measured) is that hash.

Decision: `-c` hooks are the right transport; the bypass is what makes them fire unattended.

## P2: does a repo's own `.codex` hook run under the bypass?

**Yes.** A trusted repo's `.codex/config.toml` `[[hooks.Stop]]` ran (`project-hook-ran` written)
under `--bypass --project-hook`.

**D4: `bypass: unless-project-hooks`.** A session in a repo with its own `.codex` starts without the
bypass and says why.

What that session gets, measured (`--no-bypass --project-hook --task-argv`): Codex shows the
"Hooks need review" dialog for **all** hooks, six in all, HiveTTY's five `-c` hooks and the repo's one. A task passed
after `--` on the argv still ran (plan, `touch`, reply), but **no hook fired**: no working, idle,
needs-you or plan from that session until the user trusts the hooks in that dialog, which Codex
then records in `$CODEX_HOME/config.toml` (`hooks.state`, its own write).

## P3: payloads

`hooks-*.json`, one per event, the first body each event sent in the `--bypass --plan-flag --ask` run.
All carry `session_id`, `transcript_path` (the rollout), `cwd`, `hook_event_name`, `model` and
`permission_mode`; all but `SessionStart` carry `turn_id`. `SessionStart` has `source: "startup"`.
`PermissionRequest` is Claude's shape: `tool_name: "Bash"`, `tool_input.command` and
`tool_input.description`. `Stop` has `stop_hook_active` and `last_assistant_message`. `PostToolUse`
for `update_plan` has `tool_input.plan` (`step`, `status`) as the headless fixture does.

Scrubbed the way `../README.md` describes: the scratch dir → `/tmp/codex-fixture`, the home → `/Users/me`,
every UUID → `00000000-0000-7000-8000-00000000000N` by first appearance (the session, the turn, the
`exec-` tool-use id).

## P4: is `update_plan` on by default in the TUI?

**No.** Without the flag the model said `update_plan` isn't available in this session and no
`PostToolUse` came. With `-c tools.update_plan.enabled=true` it was called and the hook fired.

**P4: `update_plan: needs-flag`.**

## P5: does the user's config still apply beside our `-c` overrides?

**Yes: model, hooks and MCP servers.** With `$CODEX_HOME/config.toml` setting `model = "gpt-5.6-terra"`,
a user `[[hooks.Stop]]` and a user `[mcp_servers.probe]`, and on the argv our `-c hooks.Stop=[…]` and a
`-c mcp_servers.hive.*` (`--bypass --user-config --hive-mcp`): the user's hook wrote `user-hook-ran`,
our `Stop` reached the server, both MCP servers were started (`user-mcp-ran`, `hive-mcp-ran`), and
every hook body named `"model": "gpt-5.6-terra"`. A `-c` hook list is added beside the user's, not
over it, and a `-c mcp_servers.<name>` is added beside the user's servers.

**P5: `user-hooks: kept`.** The model is carried in every hook body's `model` (the `SessionStart` one first).

## P6: where the rollout is

`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<session_id>.jsonl`, written at start,
the same path every hook body gives as `transcript_path`.

**P6: `sessions/YYYY/MM/DD/rollout-*-<session_id>.jsonl`.**

## P7: newline and submit

**Ctrl+J (`\n`) is a newline in the input box:** typing `…see.`, `\n`, `FIRST then SECOND` and then
`\r` submitted one message whose text is `Reply with the two lines you see.\nFIRST then SECOND` (from
the rollout). **The split `\r`, written 300 ms after the text with `tui.disable_paste_burst=true`,
submitted** in every run. **Title marks** (OSC 0/2, from the full saved `out/pty.log`,
not the 2 KB tail): Codex titles the terminal `<name> | <dir>`, where `<dir>` is the cwd's basename
and `<name>` is the thread's name once it has one (`Create probe file | repo`; just `repo` before).
While a turn runs the title leads with a braille spinner frame and a space (`⠏ Create probe file |
repo`); while it waits on an approval it leads with `[ ! ] Action Required | `. `nameFromTitle`
strips the spinner, the `[ ! ] Action Required | ` lead and the trailing ` | <dir>`.

`approval_policy = "untrusted"` is refused at 0.164 ("no longer supported"). A permission prompt
comes from `approval_policy="on-request"` with `sandbox_mode="read-only"` and a task that asks to
escalate; Enter on the highlighted option approves it.
