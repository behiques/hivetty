"""HIVE-371 Codex fan-out probe: one `codex exec --json` run, hooks and a probe MCP server attached.

    python3 codex_probe.py <out-dir> [--no-multi-agent]
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
out = os.path.abspath(sys.argv[1])
refused = '--deny-spawn' in sys.argv  # a PreToolUse deny on every spawn, as HiveTTY's fence replies
os.makedirs(out, exist_ok=True)


def toml(v):
    return json.dumps(v)


def hook(event, matcher=None):
    cmd = f'cat >> {out}/hooks.jsonl; echo >> {out}/hooks.jsonl'
    head = '' if matcher is None else f'matcher={toml(matcher)},'
    return f'hooks.{event}=[{{{head}hooks=[{{type="command",command={toml(cmd)}}}]}}]'


PROMPT = """This is a capability probe. Follow the steps exactly.
1. Before calling anything, write out the exact name and the full parameter list (names, types,
   descriptions, enum values) of every tool you have for starting, messaging, waiting on or
   closing subagents. If you have none, say "NO SUBAGENT TOOLS" and skip to step 4.
2. Start two subagents in parallel, without waiting on the first before starting the second:
   - "alpha": tell it to run the shell command `echo from-alpha`, then call the MCP tool `ping`
     on the `probe` server with label "alpha", and reply with both outputs. If your spawn tool
     lets you choose a model, give alpha the model "gpt-5.6-terra".
   - "beta": tell it to run `echo from-beta`, then call `ping` with label "beta", and reply with
     both outputs. If your spawn tool lets you restrict tools, sandbox or permissions, make beta
     read-only.
3. Wait for both, then print each subagent's reply verbatim, labelled.
4. Finish with one line per question: PARALLEL yes/no, PER-AGENT-MODEL yes/no, PER-AGENT-TOOLS
   yes/no, SUBAGENT-MCP yes/no, each with the evidence.
"""

argv = ['codex', 'exec', '--json', '--skip-git-repo-check', '--ignore-user-config',
        '--dangerously-bypass-hook-trust', '-s', 'workspace-write',
        '-c', 'model="gpt-6-luna"',
        '-c', (f'hooks.PreToolUse=[{{matcher="*",hooks=[{{type="command",command='
               f'{toml("python3 -I " + os.path.join(HERE, "deny_spawn.py") + " " + out + "/hooks.jsonl")}}}]}}]')
        if refused else hook('PreToolUse', '*'),
        '-c', hook('PostToolUse', '*'),
        '-c', hook('SubagentStart'), '-c', hook('SubagentStop'), '-c', hook('Stop'),
        '-c', 'mcp_servers.probe.command="python3"',
        '-c', f'mcp_servers.probe.args=["-I",{toml(os.path.join(HERE, "probe_mcp.py"))}]',
        '-c', f'mcp_servers.probe.env={{PROBE_LOG={toml(os.path.join(out, "mcp.jsonl"))}}}',
        '-c', 'mcp_servers.probe.default_tools_approval_mode="approve"',
        PROMPT]
wd = os.path.join(out, 'wd')
os.makedirs(wd, exist_ok=True)
with open(os.path.join(out, 'exec.jsonl'), 'w') as so, open(os.path.join(out, 'stderr.txt'), 'w') as se:
    rc = subprocess.run(argv, cwd=wd, stdout=so, stderr=se, stdin=subprocess.DEVNULL, timeout=900).returncode
print('exit', rc)
