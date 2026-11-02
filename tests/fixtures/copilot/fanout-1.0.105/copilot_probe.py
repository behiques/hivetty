"""HIVE-371 Copilot fan-out probe: one `copilot -p` run, scratch COPILOT_HOME, hooks and a probe MCP server.

    python3 copilot_probe.py <out-dir> [--deny-spawn]
"""
import json, os, subprocess, sys, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
out = os.path.abspath(sys.argv[1])
refused = '--deny-spawn' in sys.argv
home, wd = os.path.join(out, 'home'), os.path.join(out, 'wd')
for d in (home, wd, os.path.join(home, 'agents')):
    os.makedirs(d, exist_ok=True)


def rec(event):
    return [{'type': 'command', 'bash': f'cat >> {out}/hooks-{event}.jsonl; echo >> {out}/hooks-{event}.jsonl', 'timeoutSec': 10}]


hooks = {e: rec(e) for e in ('sessionStart', 'postToolUse', 'agentStop', 'subagentStop', 'subagentStart', 'sessionEnd')}
hooks['preToolUse'] = ([{'type': 'command', 'bash': f'python3 -I {HERE}/deny_spawn.py {out}/hooks-preToolUse.jsonl', 'timeoutSec': 10}]
                       if refused else rec('preToolUse'))
with open(os.path.join(home, 'settings.json'), 'w') as f:
    json.dump({'banner': 'never', 'hooks': hooks}, f, indent=2)

# Two custom agents: one pinned to a model, one narrowed to read-only tools.
with open(os.path.join(home, 'agents', 'pinned.agent.md'), 'w') as f:
    f.write('---\nname: pinned\ndescription: Probe agent pinned to a model.\nmodel: claude-sonnet-5\n---\n'
            'Do exactly what the task says and report the outputs verbatim.\n')
with open(os.path.join(home, 'agents', 'reader.agent.md'), 'w') as f:
    f.write('---\nname: reader\ndescription: Probe agent with read-only tools.\ntools: ["view", "grep", "glob"]\n---\n'
            'Do exactly what the task says. If a tool you need is unavailable, say which and stop.\n')

PROMPT = """This is a capability probe. Follow the steps exactly.
1. Before calling anything, write out the exact name and the full parameter list (names, types,
   descriptions, enum values) of every tool you have for starting, messaging, waiting on or reading
   the results of subagents, and list every agent type you can start. If you have none, say
   "NO SUBAGENT TOOLS" and skip to step 4.
2. Start two subagents in parallel, in background mode if you have one, without waiting on the
   first before starting the second:
   - "alpha", using the custom agent "pinned" if you can choose one: tell it to run the shell
     command `echo from-alpha`, then call the MCP tool `ping` on the `probe` server with label
     "alpha", and reply with both outputs and the name of the model it is running on.
   - "beta", using the custom agent "reader" if you can choose one: tell it to run
     `echo from-beta`, then call `ping` with label "beta", and reply with both outputs, or say
     which tool it lacked.
3. Wait for both, then print each subagent's reply verbatim, labelled.
4. Finish with one line per question: PARALLEL yes/no, PER-AGENT-MODEL yes/no, PER-AGENT-TOOLS
   yes/no, SUBAGENT-MCP yes/no, each with the evidence.
"""

env = {k: v for k, v in os.environ.items() if k not in ('GH_TOKEN', 'GITHUB_TOKEN')}
env['COPILOT_GITHUB_TOKEN'] = subprocess.run(['gh', 'auth', 'token'], env=env, capture_output=True, text=True).stdout.strip()
env['COPILOT_HOME'] = home
env['PROBE_LOG'] = os.path.join(out, 'mcp.jsonl')
mcp = {'mcpServers': {'probe': {'type': 'local', 'command': 'python3', 'tools': ['*'],
                                'args': ['-I', os.path.join(HERE, 'probe_mcp.py')],
                                'env': {'PROBE_LOG': os.path.join(out, 'mcp.jsonl')}}}}
argv = ['copilot', '-p', PROMPT, '-s', '--no-ask-user', '--disable-builtin-mcps',
        '--session-id', str(uuid.uuid4()), '--allow-all-tools',
        '--additional-mcp-config', json.dumps(mcp), '--log-dir', os.path.join(out, 'logs')]
with open(os.path.join(out, 'stdout.txt'), 'w') as so, open(os.path.join(out, 'stderr.txt'), 'w') as se:
    rc = subprocess.run(argv, cwd=wd, env=env, stdout=so, stderr=se, stdin=subprocess.DEVNULL, timeout=900).returncode
print('exit', rc)
