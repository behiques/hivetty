# Copilot fixtures

Recorded from a real, signed-in `GitHub Copilot CLI 1.0.104-4` on 2026-10-26 (HIVE-343), with a
scratch `COPILOT_HOME`, an OAuth token in `COPILOT_GITHUB_TOKEN`, and `GH_TOKEN` and `GITHUB_TOKEN`
unset. Each run was `copilot -p <prompt> -s --no-ask-user --disable-builtin-mcps --session-id <uuid>`
(or `--resume=<uuid>`) with `--allow-tool shell|write|<server>`, a probe MCP server on
`--additional-mcp-config`, `--usage-output-file`, and every hook event in `$COPILOT_HOME/settings.json`
set to save its stdin. `hooks-1.0.104/` holds the bodies the hooks received, renamed by event:
`agent-stop.json` and `pre-tool-use-bash.json` from a plain `echo`, `pre-tool-use-create.json` and
`permission-request-edit.json` from a file write, and `pre-tool-use-{mcp,task,subagent}.json`,
`agent-stop-subagent.json` and `agent-stop-after-subagent.json` from a run that called the probe
server and a `task` subagent. `pre-tool-use-{view,edit,glob,grep,web-fetch}.json` are from one run on
2026-10-27 (session `…555555555555`, `--allow-tool shell --allow-tool write --allow-all-urls`) asked to
view, edit, glob, grep and fetch, one file per `toolName` (`web_fetch` → `web-fetch`). `pre-tool-use-tool-search.json` is
from a run on 2026-10-27 (session `…555555555556`, the probe server serving 41 tools so Copilot defers
them) asked to find `envcheck` with its tool search: the `tool_search_tool` call. `usage-1.0.104.json` is the first run's `--usage-output-file`, and
`stderr-bad-token-1.0.104.txt` is the stderr of a run with a refused token (exit 1). `stderr-network-1.0.104.txt` is the same run on 2026-10-27 with `HTTPS_PROXY` at a closed port
(the same headline, a network detail line), and `stderr-classic-pat-1.0.104.txt` a run whose token
was a classic `ghp_` PAT (HIVE-357). `stderr-no-auth-1.0.104.txt` is a run whose token was not a token
Copilot recognises at all (`xyz`; `…` and an empty value print the same).
`usage-failed-auth-1.0.104.json` is the usage file the network run above still wrote (HIVE-357): no
request, no `tokenDetails`.

Scrubbed, consistently across every file, and nothing else:

- the probe's scratch directory under the macOS temp dir → `/tmp/copilot-fixture`;
- the home directory → `/Users/me`;
- the pinned session ids (`11111111-2222-4333-8444-55555555555N`) are already fake and stay; the
  subagent's real id → `00000000-0000-4000-8000-000000000001`.

Every other byte is as recorded. Re-record and re-scrub rather than hand-edit a line.

Re-proved, not re-recorded, against `GitHub Copilot CLI 1.0.105` on 2026-10-29 (HIVE-282): `test:agent:copilot`
passes on these fixtures unchanged.

`fanout-1.0.105/` (HIVE-371, recorded 2026-11-02 against `GitHub Copilot CLI 1.0.105`) is the subagent fan-out probe.
`copilot_probe.py` runs `copilot -p <prompt> -s --no-ask-user --disable-builtin-mcps --allow-all-tools --session-id <uuid>`
with a scratch `COPILOT_HOME` and the `gh` login's token in `COPILOT_GITHUB_TOKEN`. The home's `settings.json` saves every
`sessionStart`, `preToolUse`, `postToolUse`, `subagentStart`, `subagentStop`, `agentStop` and `sessionEnd` body, and
`probe_mcp.py` is on `--additional-mcp-config`. Two custom agents sit in `$COPILOT_HOME/agents`: `pinned` (`model:
claude-sonnet-5`) and `reader` (`tools: ["view", "grep", "glob"]`). The prompt asks for both as parallel background
subagents, each running an `echo` and the probe's `ping`. `hooks-fanout.jsonl` is that run's bodies in time order, each
wrapped as HiveTTY's hook command wraps them (`{"event":…,"payload":…}`). `events-fanout.jsonl` is its two
`subagent.started` lines from `events.jsonl`, which record each agent's model. `hooks-denied.jsonl` and `events-denied.jsonl`
(the two `tool.execution_complete` lines) are the same run with `--deny-spawn`, where `deny_spawn.py` as the `preToolUse`
hook denies every `task` call. Scrubbed, per directory and nothing else: the scratch directory → `/tmp/copilot-fixture`,
the home directory → `/Users/me`, every UUID → `00000000-0000-4000-8000-00000000000N` by first appearance, and every
`toolu_<24>` id → `toolu_<N as 24 hex>` on the same counter.

`interactive-1.0.105/post-tool-use-sql-update.json` and `session-todos.db` (HIVE-361, recorded 2026-11-04 against
`GitHub Copilot CLI 1.0.105`) are from `todos_probe.py`: one `copilot -p … -s --no-ask-user --disable-builtin-mcps
--allow-all-tools --session-id 11111111-2222-4333-8444-555555555561` with a scratch `COPILOT_HOME` whose `settings.json`
saves every `postToolUse` body and, in the same hook, the `todos` table as it stood then. The prompt asks for three `sql`
calls: insert Alpha, Beta and Gamma pending; Alpha in_progress and Gamma blocked; Alpha done. The JSON is the second
call's body (one `UPDATE … CASE id WHEN …`); the database is the session's `session.db` after the third, holding only
`todos` and `todo_deps`. Scrubbed: `cwd` → `/tmp/copilot-fixture/work`, and nothing else.
