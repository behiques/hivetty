# Codex fixtures

Recorded from a real, signed-in `codex-cli 0.164.0` on 2026-10-26 (HIVE-342), in a scratch directory
outside any repo. `exec-0.164.0.jsonl` is the stdout of `codex exec --json --skip-git-repo-check
--ignore-user-config --dangerously-bypass-hook-trust -s workspace-write` with `-c hooks.Stop` and
`-c hooks.PreToolUse` set to `cat >> hooks.jsonl`, the hive MCP host as `-c mcp_servers.hive.*`
(`default_tools_approval_mode="approve"`), and a prompt asking for `echo hi`, an `apply_patch`, one
`ledger_read` call and a final message. `exec-resume-0.164.0.jsonl` is `codex exec resume --json
--skip-git-repo-check --ignore-user-config -c sandbox_mode="read-only" <thread_id>` asking for the
remembered word. `hooks-0.164.0.jsonl` is what the hooks received.

Scrubbed, consistently across all three files, and nothing else:

- the home directory → `/Users/me`;
- the macOS scratch directory (`/private/var/folders/…/T/tmp.…`) → `/tmp/codex-fixture`;
- every UUID (the thread, the turn, the three tool-call ids) → `00000000-0000-7000-8000-00000000000N`,
  numbered by first appearance (exec, then hooks, then resume), the same id mapped the same way in
  every file.

Every other byte is as recorded, the `error` warning items included. Re-record and re-scrub rather
than hand-edit a line.
