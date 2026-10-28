"""Drive a real copilot TUI on a pty (HIVE-280), as tests/live/session-codex-conformance.test.ts does.

Config, one JSON argument:
  {argv, cwd, env, seconds, keys: [[atSeconds, "text"], ...], react: [["pattern", "text"], ...], log}

The pty is sized 40x120 and the TUI's start-up queries are answered as xterm.js does. Each key is
written at its time (a "\r" submits). Each react entry fires once, in order, the first time its
pattern appears in the output after the last key was written. The raw output is saved to `log`.
"""
import fcntl, json, os, pty, select, struct, sys, termios, time

c = json.loads(sys.argv[1])
Q = [(b'\x1b[6n', b'\x1b[1;1R'),
     (b'\x1b]10;?\x1b\\', b'\x1b]10;rgb:d8d8/d8d8/d8d8\x1b\\'), (b'\x1b]11;?\x1b\\', b'\x1b]11;rgb:1818/1818/1818\x1b\\'),
     (b'\x1b]10;?\x07', b'\x1b]10;rgb:d8d8/d8d8/d8d8\x07'), (b'\x1b]11;?\x07', b'\x1b]11;rgb:1818/1818/1818\x07'),
     (b'\x1b[?u', b'\x1b[?0u'), (b'\x1b[c', b'\x1b[?62;22c')]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(c['cwd'])
    try: os.execvpe(c['argv'][0], c['argv'], c['env'])
    finally: os._exit(127)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
keys = sorted(c.get('keys', []), key=lambda k: k[0])
react = list(c.get('react', []))
out = bytearray(); replied = 0; start = time.time(); mark = 0
while time.time() - start < c['seconds']:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try: d = os.read(fd, 65536)
        except OSError: break
        if not d: break
        out += d
        while True:
            tail = bytes(out[replied:])
            hits = [(tail.find(q), q, a) for q, a in Q if tail.find(q) >= 0]
            if not hits: break
            at, q, a = min(hits); os.write(fd, a); replied += at + len(q)
    now = time.time() - start
    while keys and keys[0][0] <= now:
        os.write(fd, keys.pop(0)[1].encode()); mark = len(out)
    if not keys and react and react[0][0].encode() in bytes(out[mark:]):
        time.sleep(0.5); os.write(fd, react.pop(0)[1].encode()); mark = len(out)
try: os.kill(pid, 9)
except Exception: pass
with open(c['log'], 'wb') as f: f.write(bytes(out))
