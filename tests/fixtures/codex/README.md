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
