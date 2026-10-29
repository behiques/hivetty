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
