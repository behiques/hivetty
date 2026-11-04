"""HIVE-361 probe: one `copilot -p` run, scratch COPILOT_HOME, every postToolUse body saved.

    python3 -I todos_probe.py <out-dir>
"""
import json, os, subprocess, sys

out = os.path.abspath(sys.argv[1])
home, wd = os.path.join(out, 'home'), os.path.join(out, 'wd')
for d in (home, wd):
    os.makedirs(d, exist_ok=True)
log = os.path.join(out, 'hooks-postToolUse.jsonl')
db = os.path.join(home, 'session-state', '11111111-2222-4333-8444-555555555561', 'session.db')
# What the table holds at the moment the hook runs: proves the call has committed before its postToolUse.
at_hook = f'sqlite3 {db} "select id, status from todos order by created_at, rowid" >> {out}/at-hook.txt; echo --- >> {out}/at-hook.txt'
hooks = {'postToolUse': [{'type': 'command', 'bash': f'cat >> {log}; echo >> {log}; {at_hook}', 'timeoutSec': 10}]}
with open(os.path.join(home, 'settings.json'), 'w') as f:
    json.dump({'banner': 'never', 'hooks': hooks}, f, indent=2)

PROMPT = """Use your sql tool to keep a todo list for this task, in three separate sql calls:
1. Insert three todos, ids 'alpha', 'beta', 'gamma', titles Alpha, Beta, Gamma, all pending.
2. Set Alpha to in_progress and Gamma to blocked.
3. Set Alpha to done.
Then reply DONE. Do nothing else."""

env = {k: v for k, v in os.environ.items() if k not in ('GH_TOKEN', 'GITHUB_TOKEN')}
env['COPILOT_GITHUB_TOKEN'] = subprocess.run(['gh', 'auth', 'token'], env=env, capture_output=True, text=True).stdout.strip()
env['COPILOT_HOME'] = home
argv = ['copilot', '-p', PROMPT, '-s', '--no-ask-user', '--disable-builtin-mcps',
        '--session-id', '11111111-2222-4333-8444-555555555561', '--allow-all-tools']
with open(os.path.join(out, 'stdout.txt'), 'w') as so, open(os.path.join(out, 'stderr.txt'), 'w') as se:
    rc = subprocess.run(argv, cwd=wd, env=env, stdout=so, stderr=se, stdin=subprocess.DEVNULL, timeout=600).returncode
print('exit', rc)
