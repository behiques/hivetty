#!/usr/bin/env python3
"""Probe a real interactive `codex` 0.164.x TUI on a pty (HIVE-279, Task 1).

Answers P1-P7 of .hive/specs/2026-10-27-codex-interactive-sessions.md: which `-c hooks.<E>` hooks
fire with and without `--dangerously-bypass-hook-trust`, whether a repo's own `.codex` hook runs
under the bypass, whether a user's config.toml (model, Stop hook) survives our `-c` overrides, the
hook payloads, the rollout layout, and how the input box takes a newline and a submit.

Every run gets its own scratch dir and `CODEX_HOME`, holding a *copy* of ~/.codex/auth.json (never
linked, never written back). Nothing is written under ~/.codex.

    python3 probe.py --bypass                     # P1, P3, P4, P6, P7
    python3 probe.py --no-bypass                  # P1 without the bypass
    python3 probe.py --bypass --project-hook      # P2 -> D4
    python3 probe.py --bypass --user-config       # P5
"""

import argparse
import fcntl
import http.server
import json
import os
import pty
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import threading
import time

QUERIES = [
    (b'\x1b[6n', b'\x1b[1;1R'),
    (b'\x1b]10;?\x1b\\', b'\x1b]10;rgb:d8d8/d8d8/d8d8\x1b\\'),
    (b'\x1b]11;?\x1b\\', b'\x1b]11;rgb:1818/1818/1818\x1b\\'),
    (b'\x1b[?u', b'\x1b[?0u'),
    (b'\x1b[c', b'\x1b[?62;22c'),
]

EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop']
PROMPT = (
    'Make a two-step plan with update_plan (steps A, B; A in_progress), '
    'then run the shell command: touch probe.txt. '
    'If the sandbox blocks it, request approval to run it with escalated permissions.'
)


def toml(value):
    return json.dumps(value)


def hook(event, command, matcher=None):
    head = '' if matcher is None else f'matcher={toml(matcher)},'
    return f'hooks.{event}=[{{{head}hooks=[{{type="command",command={toml(command)}}}]}}]'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bypass', dest='bypass', action='store_true')
    ap.add_argument('--no-bypass', dest='bypass', action='store_false')
    ap.add_argument('--project-hook', action='store_true')
    ap.add_argument('--user-config', action='store_true')
    ap.add_argument('--plan-flag', action='store_true', help='add -c tools.update_plan.enabled=true')
    ap.add_argument('--ask', action='store_true', help='on-request in a read-only sandbox, so the touch asks')
    ap.add_argument('--newline-probe', action='store_true', help='type a Ctrl+J between two lines')
    ap.add_argument('--seconds', type=int, default=60)
    ap.set_defaults(bypass=True)
    a = ap.parse_args()

    # Real path: codex keys a project's trust by it, and /var is /private/var on macOS.
    scratch = os.path.realpath(tempfile.mkdtemp(prefix='codex-probe-'))
    repo = os.path.join(scratch, 'repo')
    home = os.path.join(scratch, 'codex-home')
    out = os.path.join(scratch, 'out')
    for d in (repo, home, out):
        os.makedirs(d)
    subprocess.run(['git', 'init', '-q', repo], check=True)
    shutil.copyfile(os.path.expanduser('~/.codex/auth.json'), os.path.join(home, 'auth.json'))

    # The scratch repo is trusted, as a user's own repo is, so its .codex config is loaded at all.
    user_config = f'[projects.{toml(repo)}]\ntrust_level = "trusted"\n'
    if a.user_config:
        user_config = (
            'model = "gpt-5.6-terra"\n\n'
            + user_config
            + f'\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\n'
            + f'command = {toml("touch " + os.path.join(out, "user-hook-ran"))}\n'
        )
    with open(os.path.join(home, 'config.toml'), 'w') as f:
        f.write(user_config)
    if a.project_hook:
        os.makedirs(os.path.join(repo, '.codex'))
        with open(os.path.join(repo, '.codex', 'config.toml'), 'w') as f:
            f.write(
                '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\n'
                + f'command = {toml("touch " + os.path.join(out, "project-hook-ran"))}\n'
            )

    bodies = os.path.join(out, 'bodies.jsonl')
    lock = threading.Lock()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers.get('content-length') or 0)
            body = self.rfile.read(n).decode('utf-8', 'replace')
            with lock, open(bodies, 'a') as f:
                f.write(json.dumps({'path': self.path, 'body': body}) + '\n')
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    def post(event):
        return f'curl -sS -m 3 -X POST http://127.0.0.1:{port}/{event} --data-binary @- >/dev/null 2>&1 || true'

    argv = ['codex', '-c', 'tui.disable_paste_burst=true']
    for e in EVENTS:
        argv += ['-c', hook(e, post(e))]
    argv += ['-c', hook('PostToolUse', post('PostToolUse'), 'update_plan')]
    if a.plan_flag:
        argv += ['-c', 'tools.update_plan.enabled=true']
    if a.ask:
        # 0.164 refuses "untrusted"; a write in a read-only sandbox is what asks.
        argv += ['-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="read-only"']
    if a.bypass:
        argv += ['--dangerously-bypass-hook-trust']

    env = {k: v for k, v in os.environ.items() if not k.startswith(('CODEX_', 'HIVE_', 'OPENAI_'))}
    env.update(CODEX_HOME=home, TERM='xterm-256color')

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        os.execvpe('codex', argv, env)

    # A pty with no size draws nothing: give it the size a session pane starts at.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))

    output = bytearray()
    replied = 0
    start = time.time()
    step = 0
    answered = False
    while time.time() - start < a.seconds + 12:
        r, _, _ = select.select([fd], [], [], 0.3)
        if r:
            try:
                d = os.read(fd, 65536)
            except OSError:
                break
            if not d:
                break
            output += d
            # Answer the TUI's terminal queries the way xterm.js does, or it waits on them.
            while True:
                tail = bytes(output[replied:])
                hits = [(tail.find(q), q, ans) for q, ans in QUERIES if tail.find(q) >= 0]
                if not hits:
                    break
                at, q, ans = min(hits)
                os.write(fd, ans)
                replied += at + len(q)
        now = time.time() - start
        if step == 0 and now > 8:
            if a.newline_probe:
                os.write(fd, b'Reply with the two lines you see.')
                time.sleep(0.3)
                os.write(fd, b'\n')
                time.sleep(0.3)
                os.write(fd, b'FIRST then SECOND')
            else:
                os.write(fd, PROMPT.encode())
            step = 1
        elif step == 1 and now > 8.3 + (0.6 if a.newline_probe else 0):
            os.write(fd, b'\r')
            step = 2
        elif step == 2 and not answered and b'Would you like to run' in output[-8000:]:
            time.sleep(0.5)
            os.write(fd, b'\r')
            answered = True
        elif step == 2 and now > a.seconds:
            os.write(fd, b'/exit')
            time.sleep(0.3)
            os.write(fd, b'\r')
            step = 3
    try:
        os.kill(pid, 9)
    except Exception:
        pass
    server.shutdown()

    with open(os.path.join(out, 'pty.log'), 'wb') as f:
        f.write(bytes(output))

    seen = []
    if os.path.exists(bodies):
        with open(bodies) as f:
            seen = [json.loads(line) for line in f]
    first = {}
    for s in seen:
        first.setdefault(s['path'].lstrip('/'), s['body'])
    session_id = None
    if seen:
        try:
            session_id = json.loads(seen[0]['body']).get('session_id')
        except ValueError:
            pass
    rollouts = []
    for root, _, files in os.walk(os.path.join(home, 'sessions')):
        for name in files:
            rollouts.append(os.path.relpath(os.path.join(root, name), home))

    report = {
        'scratch': scratch,
        'argv': argv,
        'bypass': a.bypass,
        'events': [s['path'].lstrip('/') for s in seen],
        'session_id': session_id,
        'project_hook_ran': os.path.exists(os.path.join(out, 'project-hook-ran')),
        'user_hook_ran': os.path.exists(os.path.join(out, 'user-hook-ran')),
        'models_named': sorted(
            {json.loads(b).get('model') for b in first.values() if b.startswith('{')} - {None}
        ),
        'update_plan_seen': 'PostToolUse' in first,
        'approval_answered': answered,
        'rollouts': rollouts,
        'pty_tail': bytes(output[-2048:]).decode('utf-8', 'replace'),
    }
    with open(os.path.join(out, 'first-bodies.json'), 'w') as f:
        json.dump(first, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
