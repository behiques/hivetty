# Codex fixtures

Recorded from a real, signed-in `codex-cli 0.164.0` on 2026-10-26 (HIVE-342), in a scratch directory
outside any repo. `exec-0.164.0.jsonl` is the stdout of `codex exec --json --skip-git-repo-check
--ignore-user-config --dangerously-bypass-hook-trust -s workspace-write` with `-c hooks.Stop` and
`-c hooks.PreToolUse` set to `cat >> hooks.jsonl`, the hive MCP host as `-c mcp_servers.hive.*`
(`default_tools_approval_mode="approve"`), and a prompt asking for `echo hi`, an `apply_patch`, one
`ledger_read` call and a final message. `exec-resume-0.164.0.jsonl` is `codex exec resume --json
--skip-git-repo-check --ignore-user-config -c sandbox_mode="read-only" <thread_id>` asking for the
remembered word. `hooks-0.164.0.jsonl` is what the hooks received.

Scrubbed, consistently across the three files recorded under HIVE-342, and nothing else:

- the home directory → `/Users/me`;
- the macOS scratch directory (`/private/var/folders/…/T/tmp.…`) → `/tmp/codex-fixture`;
- every UUID (the thread, the turn, the three tool-call ids) → `00000000-0000-7000-8000-00000000000N`,
  numbered by first appearance (exec, then hooks, then resume), the same id mapped the same way in
  every file.

The directory holds four files. `hooks-update-plan-0.164.0.jsonl` (HIVE-352, recorded 2026-10-27) is every `PostToolUse` body of
`codex exec --json --skip-git-repo-check --ignore-user-config --dangerously-bypass-hook-trust -s
read-only -c tools.update_plan.enabled=true -c features.multi_agent=true`, with `-c
hooks.PostToolUse` (`matcher="*"`) appending each body and a newline to the file, and a prompt
asking for one subagent that plans "Child step" in progress then completed, then three main-thread
`update_plan` calls over "write tests" and "make them pass". The subagent's bodies carry
`agent_id` and `agent_type`. Its UUIDs are numbered on their own, from 1.

Scrubbed there as well, and nothing else: the home directory → `/Users/me`, the scratch directory →
`/tmp/codex-fixture`, every UUID → `00000000-0000-7000-8000-00000000000N`, the two `call_<32 hex>` tool
ids of the `spawn_agent` and `wait_agent` calls → `exec-00000000-0000-7000-8000-00000000000a` and
`…0b` (the shape the other fixtures give tool ids), and the encrypted `gAAAAA…` blob in the
`spawn_agent` call's `message` → a same-length synthetic `SYNTHETIC-ENCRYPTED-PLACEHOLDER-…==` string.

Every other byte is as recorded, the `error` warning items included. Re-record and re-scrub rather
than hand-edit a line.

`interactive-0.164/` (HIVE-279, recorded 2026-10-27) holds `probe.py`, `FINDINGS.md` and one `hooks-<event>.json` per
event: the first body each of `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUse` (`update_plan`) and `Stop`
sent from a real interactive `codex-cli 0.164.0` on a pty. Scrubbed there, and nothing else: the scratch directory →
`/tmp/codex-fixture` (so `cwd` and `transcript_path` name no home directory or username), every UUID (the session, the turn, the
`exec-` tool-use id) → `00000000-0000-7000-8000-00000000000N` by first appearance, and the rollout file's timestamp is as
recorded. Audited for home directories, usernames, hostnames, temp paths, emails, tokens, JWTs, `gAAAAA…` blobs, `call_<hex>`
ids and IP addresses (only `127.0.0.1` in `probe.py`): none found. `probe.py` is a manual tool no test, script or CI step runs;
it copies `~/.codex/auth.json` into its own temp `CODEX_HOME` and deletes the copy when the run ends.

Re-proved, not re-recorded, against `codex-cli 0.165.0` on 2026-10-29 (HIVE-282): `test:agent:codex` and
`test:session:codex` pass on these fixtures unchanged. One new finding: an Esc on the interactive approval
prompt fires no hook (HIVE-365).

Three rollout records pin the meters fold (HIVE-334, recorded 2026-10-29 from `codex-cli 0.165.0` unless named otherwise).
`rollout-0.165.0.jsonl` is the rollout of one `python3 tests/fixtures/codex/interactive-0.164/probe.py --bypass --seconds 90`
run (a real interactive TUI on a pty, Plus plan). `rollout-exec-0.165.0.jsonl` is the rollout of one `codex exec --json
--skip-git-repo-check -s read-only "Reply with the single word DONE."` run in a scratch directory outside any repo, taken from
`~/.codex/sessions` by its first line's `"originator":"codex_exec"` and `"cli_version":"0.165.0"`. Both were filtered with

```sh
rg '^\{"timestamp":"[^"]*",("ordinal":[0-9]+,)?"type":"(turn_context|event_msg)"' <rollout>
```

because `session_meta` carries account ids and the full base instructions, and `response_item` carries encrypted reasoning.
The `event_msg` kinds that are not `token_count` stay, so the fold is seen to skip them. `token-count-free-0.164.0.jsonl` is
one `token_count` line with `"plan_type":"free"` (a single `"window_minutes":43200` window, `"secondary":null`), taken from
a `codex-cli 0.164.0` rollout already in `~/.codex/sessions`. All three are scrubbed by the rules above, and nothing else: the
home directory → `/Users/me`, the scratch directory → `/tmp/codex-fixture`, every UUID → `00000000-0000-7000-8000-00000000000N`
by first appearance per file, any `user-…` or account id → `user-0000` (none were present after the filter). Credits present
or unlimited cannot be recorded on this account (`has_credits: false`), so the tests that need them edit only
`rate_limits.credits` of a recorded line.
