# Codex fixtures

Recorded from a real, signed-in `codex-cli 0.164.0` on 2026-10-26 (HIVE-342), in a scratch directory
outside any repo. `exec-0.164.0.jsonl` is the stdout of `codex exec --json --skip-git-repo-check
--ignore-user-config --dangerously-bypass-hook-trust -s workspace-write` with `-c hooks.Stop` and
`-c hooks.PreToolUse` set to `cat >> hooks.jsonl`, the hive MCP host as `-c mcp_servers.hive.*`
(`default_tools_approval_mode="approve"`), and a prompt asking for `echo hi`, an `apply_patch`, one
`ledger_read` call and a final message. `exec-resume-0.164.0.jsonl` is `codex exec resume --json
--skip-git-repo-check --ignore-user-config -c sandbox_mode="read-only" <thread_id>` asking for the
remembered word. `hooks-0.164.0.jsonl` is what the hooks received. The home directory is replaced
with `/Users/me`; every line is otherwise byte for byte, the `error` warning items included.
Re-record rather than hand-edit a line.
