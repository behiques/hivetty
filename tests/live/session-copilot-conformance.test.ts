// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copilotAdapter } from '../../electron/main/harness/copilot';
import { launchCopilotSession } from '../../electron/main/harness/copilot/launch';
import { copilotRecord } from '../../electron/main/harness/copilot/record';
import type { LaunchSpec } from '../../electron/main/harness/port';
import { createHarnessRegistry } from '../../electron/main/harness/registry';
import { createReceiver, type Receiver } from '../../electron/main/hooks/receiver';
import { createStatusTracker, type StatusTracker } from '../../electron/main/hooks/tracker';
import type { StdioServerSpec } from '../../electron/main/mcp/agent-config';
import { createNotificationHub, createNotifier } from '../../electron/main/notifications';
import {
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  HOOK_PATH,
  type HookStatusEvent,
} from '../../electron/shared/hook-contract';
import { CH } from '../../electron/shared/ipc-contract';
import type { HiveNotification } from '../../electron/shared/notification-contract';

/**
 * What only a real interactive `copilot` can prove about a Copilot session (HIVE-280).
 *
 * The unit suites hold the argv (`launch.test.ts`), the record, and the recorded hook bodies through
 * the receiver. This holds them against the binary on a real pty: the line is
 * **`launchCopilotSession`'s own**, its `unset …;` and `&& exit` dropped (asserted present) and the
 * rest split the way the login shell would, so a flag the TUI refuses fails here. Its plugin files
 * are written first, as the core writes them. The receiver, tracker and notifier are the real ones
 * `sessions/index.ts` drives, with a registry answering `copilot` for the session. Every key the
 * driver types is reported back and read as the user's (`answersBlock`), as `ptyWrite` is.
 *
 * Every case gets a scratch git repo and a scratch `COPILOT_HOME` holding a **copy** of
 * `~/.copilot/config.json` with the repo trusted (and the user's installed plugins left out, so no
 * case waits on a plugin install); nothing is written under `~/.copilot`. Every ambient `HIVE_*`,
 * `COPILOT_*`, `GH_TOKEN` and `GITHUB_TOKEN` is stripped. Each case writes `finding.json` beside its
 * scratch repo, and logs where.
 *
 * Opt-in: `pnpm test:session:copilot`. Skipped unless `copilot --version` is 1.0.105 and
 * `~/.copilot/config.json` holds a login; about six minutes.
 */

const LIVE = process.env['HIVE_LIVE_SESSION_COPILOT_PROOF'] === '1';
const CONFIG = join(homedir(), '.copilot', 'config.json');
const READY =
  LIVE &&
  existsSync(CONFIG) &&
  /loggedInUsers/.test(readFileSync(CONFIG, 'utf8')) &&
  /^GitHub Copilot CLI 1\.0\.105\b/.test(spawnSync('copilot', ['--version'], { encoding: 'utf8' }).stdout ?? '');
const SESSION = 'sess-cp';
const CASE_MS = 240_000;

/**
 * The pty driver, `tests/fixtures/copilot/interactive-1.0.105/probe.py`'s loop. It sizes the pty
 * and answers the TUI's start-up queries as xterm.js does, types the prompt and its `\r` 300 ms
 * apart (HIVE-63), and answers Copilot's own approval prompt with `answer` when given. It ends the
 * turn's drive when the test writes `stop` (a turn-end reached the receiver) or, after an Esc, when
 * the TUI says the operation was cancelled; then types `after`, and `/exit`s, or kills the process
 * and waits for it to be gone (`kill`). A "Session in use" dialog is answered "Resume anyway".
 * Every key it types is printed as a JSON line, for the test to read as the user's.
 */
const DRIVER = String.raw`
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
out = bytearray(); replied = 0; start = time.time()
def key(text):
    os.write(fd, text.encode()); print(json.dumps({'key': text}), flush=True)
def pump(seconds):
    global replied, out
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if not r: continue
        try: d = os.read(fd, 65536)
        except OSError: return False
        if not d: return False
        out += d
        while True:
            tail = bytes(out[replied:])
            hits = [(tail.find(q), q, a) for q, a in Q if tail.find(q) >= 0]
            if not hits: break
            at, q, a = min(hits); os.write(fd, a); replied += at + len(q)
    return True
def seen(text, since): return text.encode() in bytes(out[since:])
pump(4)
if seen('Resume anyway', 0): key('1'); pump(2)
pump(4)
for line in c['prompts']:
    mark = len(out)
    key(line); pump(0.3); key('\r')
    answered = c.get('answer') is None; cancelled_at = None
    while time.time() - start < c['seconds']:
        if not pump(0.5): break
        if not answered and seen('Do you want', mark):
            pump(0.5); key(c['answer']); answered = True; cancelled_at = len(out) if c['answer'] == '\x1b' else None
        if os.path.exists(c['stop']): os.remove(c['stop']); break
        if cancelled_at is not None and seen('cancelled', cancelled_at): break
    pump(1.5)
for text in c.get('after', []):
    key(text); pump(0.3); key('\r'); pump(c.get('afterSeconds', 4))
if c.get('kill'):
    os.kill(pid, 9); os.waitpid(pid, 0)
else:
    key('/exit'); pump(0.3); key('\r'); pump(6)
    try: os.kill(pid, 9); os.waitpid(pid, 0)
    except Exception: pass
open(c['log'], 'wb').write(bytes(out))
`;

/** A minimal stdio MCP server: answers `initialize` and `tools/list`, and touches `$MARK` once started. */
const MCP_STUB = String.raw`
import json, os, sys
if os.environ.get('MARK'): open(os.environ['MARK'], 'w').close()
for line in sys.stdin:
    try: m = json.loads(line)
    except Exception: continue
    if 'id' not in m: continue
    r = {}
    if m.get('method') == 'initialize':
        r = {'protocolVersion': m['params'].get('protocolVersion', '2024-11-05'), 'capabilities': {'tools': {}}, 'serverInfo': {'name': sys.argv[1], 'version': '0'}}
    elif m.get('method') == 'tools/list':
        r = {'tools': [{'name': 'noop', 'description': 'does nothing', 'inputSchema': {'type': 'object', 'properties': {}}}]}
    sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': m['id'], 'result': r}) + '\n'); sys.stdout.flush()
`;

/** Escape sequences out, and every space: a TUI wraps and pads what it draws. */
const flat = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\x1b\[[0-9;?<>=]*[a-zA-Z~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]/g, '')
    .replace(/\s+/g, '');

/** `config.json` is JSON with `//` comment lines (Copilot's own header). */
const readConfig = (path: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n'),
  ) as Record<string, unknown>;

describe.skipIf(!READY)('a real interactive copilot session (HIVE-280)', () => {
  let receiver: Receiver;
  let tracker: StatusTracker;
  let url: string;
  let statuses: Array<{ status: string; signal?: HookStatusEvent['signal']; sessionUuid?: string }>;
  let raised: HiveNotification[];
  let dismissed: Array<string | null>;
  let scratch: string;
  let repo: string;
  let home: string;
  let stop: string;
  let observe: (status: string, signal?: HookStatusEvent['signal'], sessionUuid?: string) => void;

  beforeEach(async () => {
    statuses = [];
    raised = [];
    dismissed = [];
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'copilot-session-live-')));
    repo = join(scratch, 'repo');
    home = join(scratch, 'copilot-home');
    stop = join(scratch, 'turn-ended');
    mkdirSync(repo);
    mkdirSync(home);
    spawnSync('git', ['init', '-q', repo]);
    const config = readConfig(CONFIG);
    delete config['installedPlugins'];
    const trusted = Array.isArray(config['trustedFolders']) ? (config['trustedFolders'] as string[]) : [];
    config['trustedFolders'] = [...trusted, repo];
    writeFileSync(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(join(scratch, 'mcp-stub.py'), MCP_STUB);

    tracker = createStatusTracker();
    const hub = createNotificationHub({
      prefs: () => ({}),
      present: () => {},
      broadcast: (n) => raised.push(n),
      activate: () => undefined,
      announceRead: () => undefined,
      announceBadge: () => {},
      announceDismissed: (id) => {
        dismissed.push(id);
      },
      now: () => Date.now(),
    });
    const notifier = createNotifier({ hub, isForeground: () => false, isForegroundEverywhere: () => false });
    observe = (status, signal, sessionUuid) => {
      const event = {
        entityId: SESSION,
        status,
        ...(signal === undefined ? {} : { signal }),
        ...(sessionUuid === undefined ? {} : { sessionUuid }),
      };
      statuses.push(event);
      notifier.observe(CH.sessionStatus, event as unknown as Record<string, unknown>);
    };
    receiver = createReceiver({
      knowsSession: (id) => id === SESSION,
      knowsAgent: () => false,
      onAgentEvent: () => {},
      harnesses: createHarnessRegistry({ sessionHarness: (id) => (id === SESSION ? 'copilot' : undefined) }),
      onEvent: (e) => {
        const derived = tracker.apply({
          entityId: e.entityId,
          signal: e.signal,
          ...(e.toolUseId === undefined ? {} : { toolUseId: e.toolUseId }),
          ...(e.toolName === undefined ? {} : { toolName: e.toolName }),
        });
        observe(derived.status, e.signal, e.sessionUuid);
        if (e.signal.kind === 'turn-end') writeFileSync(stop, '');
      },
      onPlan: () => {},
      onTicketIntent: () => undefined,
      onPromptName: () => {},
      onCleared: () => undefined,
      onDone: () => {},
      onReady: () => {},
      onMetrics: () => {},
      onLedgerRead: () => ({ entries: [], openAsks: [], claims: {} }),
      onLedgerPost: () => ({ ok: false as const, status: 503, reason: 'not exercised by this suite' }),
      onAgentsList: () => Promise.reject(new Error('not exercised by this suite')),
    });
    const started = await receiver.start();
    expect(started).not.toBeNull();
    url = started as string;
  });

  afterEach(async () => {
    await receiver.stop();
    // The evidence stays; the login's copy does not.
    rmSync(join(home, 'config.json'), { force: true });
  });

  /** A stdio server for `--additional-mcp-config` or the user's `mcp-config.json`. */
  const stub = (name: string, mark?: string): StdioServerSpec => ({
    command: 'python3',
    args: [join(scratch, 'mcp-stub.py'), name],
    env: mark === undefined ? {} : { MARK: mark },
  });

  interface Drive {
    spec?: Partial<LaunchSpec>;
    prompts: string[];
    answer?: string;
    after?: string[];
    kill?: boolean;
  }

  /** One launch, its prompts, one turn each. Resolves with the pty log's path. */
  const run = async (name: string, sessionUuid: string, drive: Drive): Promise<string> => {
    const plan = launchCopilotSession({ command: 'copilot', sessionUuid, stateDir: join(scratch, 'state'), ...drive.spec });
    // As the core does, before the first keystroke.
    for (const file of plan.files ?? []) {
      mkdirSync(join(file.path, '..'), { recursive: true });
      writeFileSync(file.path, file.text);
    }
    const head = 'unset COPILOT_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN; ';
    expect(plan.command.startsWith(head)).toBe(true);
    expect(plan.command.endsWith(' && exit')).toBe(true);
    const split = spawnSync('python3', ['-c', 'import json,shlex,sys; print(json.dumps(shlex.split(sys.argv[1])))', plan.command.slice(head.length, -' && exit'.length)], {
      encoding: 'utf8',
    });
    const argv = JSON.parse(split.stdout) as string[];

    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && !/^(HIVE_|COPILOT_|GH_TOKEN$|GITHUB_TOKEN$)/.test(entry[0]),
      ),
    );
    Object.assign(env, {
      COPILOT_HOME: home,
      TERM: 'xterm-256color',
      [HOOK_ENV_RECEIVER_URL]: url.slice(0, -HOOK_PATH.length),
      [HOOK_ENV_SESSION]: SESSION,
      [HOOK_ENV_TOKEN]: receiver.tokenFor(SESSION),
    });
    const log = join(scratch, `${name}.pty.log`);
    const config = { argv, env, cwd: repo, seconds: 180, log, stop, ...drive };
    const stderr: Buffer[] = [];
    await new Promise<void>((resolve) => {
      const child = spawn('python3', ['-c', DRIVER, JSON.stringify(config)], { stdio: ['ignore', 'pipe', 'pipe'] });
      // Each key the driver types reaches the session as the user's, as `ptyWrite` does (`sessions/index.ts`).
      createInterface({ input: child.stdout }).on('line', (line) => {
        const typed = (JSON.parse(line) as { key: string }).key;
        const answer = copilotAdapter.answersBlock?.(typed) ?? null;
        if (answer === null) return;
        const derived = tracker.release(SESSION, { endTurn: answer === 'cancelled' });
        if (derived !== undefined) observe(derived.status);
      });
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('exit', () => resolve());
    });
    if (stderr.length > 0) console.info('DRIVER   ', Buffer.concat(stderr).toString('utf8'));
    return log;
  };

  const finding = (name: string, body: Record<string, unknown>): void => {
    const path = join(scratch, `${name}.finding.json`);
    writeFileSync(
      path,
      JSON.stringify({ statuses, raised: raised.map((n) => n.kind), dismissed, ...body }, null, 2),
    );
    console.info('EVIDENCE ', path);
  };

  const UUID = '11111111-2222-4333-8444-5555555555a1';

  it(
    'reports working, then idle, from its own hooks, on the pinned id',
    async () => {
      // A stand-in hive server, so the argv's most quoted part (`--additional-mcp-config`) goes through
      // the real binary: Copilot starting it is the proof it parsed. The ledger tools are test:agent's.
      const marker = join(scratch, 'hive-mcp-ran');
      await run('status', UUID, { spec: { hiveServer: stub('hive', marker) }, prompts: ['Reply with the single word READY.'] });
      finding('status', {});

      const seen = statuses.map((s) => s.status);
      expect(seen).toContain('working');
      const idle = seen.lastIndexOf('idle');
      expect(idle).toBeGreaterThan(seen.indexOf('working'));
      expect(statuses[idle]!.signal?.kind).toBe('turn-end');
      expect(statuses.filter((s) => s.sessionUuid !== undefined).every((s) => s.sessionUuid === UUID)).toBe(true);
      expect(existsSync(marker)).toBe(true);
    },
    CASE_MS,
  );

  it(
    'raises a permission card and needs-you for a shell call; approving clears both',
    async () => {
      await run('permission', UUID, { prompts: ['Run the shell command: echo hive > made.txt'], answer: '\r' });
      finding('permission', {});

      const waiting = statuses.findIndex((s) => s.status === 'waiting');
      expect(waiting).toBeGreaterThanOrEqual(0);
      expect(statuses[waiting]!.signal).toMatchObject({ kind: 'waiting', reason: 'permission' });
      expect(statuses.slice(waiting + 1).some((s) => s.status !== 'waiting')).toBe(true);
      expect(raised.filter((n) => n.kind === 'session.blocked')).toHaveLength(1);
      expect(statuses.at(-1)?.status).toBe('idle');
      expect(existsSync(join(repo, 'made.txt'))).toBe(true);
    },
    CASE_MS,
  );

  it(
    'clears the card and needs-you on an Esc denial, which fires no hook (D5 amended)',
    async () => {
      await run('denial', UUID, { prompts: ['Run the shell command: echo nope > nope.txt'], answer: '\x1b' });
      finding('denial', {});

      const waiting = statuses.findIndex((s) => s.status === 'waiting');
      expect(waiting).toBeGreaterThanOrEqual(0);
      expect(raised.map((n) => n.kind)).toContain('session.blocked');
      // The Esc, read as the user's: the row goes idle and the card's row is dismissed.
      expect(statuses.at(-1)?.status).toBe('idle');
      expect(statuses.at(-1)?.signal).toBeUndefined();
      expect(dismissed.length).toBeGreaterThan(0);
      expect(existsSync(join(repo, 'nope.txt'))).toBe(false);
    },
    CASE_MS,
  );

  it(
    'resumes by the pinned id after a kill, and the conversation continues',
    async () => {
      const id = '11111111-2222-4333-8444-5555555555a2';
      await run('resume-1', id, { prompts: ['Remember the word PERSIMMON. Reply OK.'], kill: true });
      // What `history.resumable` asks before it offers a resume.
      expect(copilotRecord(() => home).hasTranscript(repo, id)).toBe(true);

      // Reversed: the transcript holds the first turn, and only a remembering model writes this.
      await run('resume-2', id, {
        spec: { resume: true },
        prompts: ['What word did I ask you to remember? Reply with it reversed, in lowercase, and nothing else.'],
      });
      finding('resume', { id });

      // From the transcript: the TUI's spinner interleaves its frames with the reply it draws.
      const transcript = copilotRecord(() => home).transcriptPath(repo, id);
      expect(readFileSync(transcript!, 'utf8').toLowerCase()).toContain('nommisrep');
      expect(statuses.filter((s) => s.sessionUuid !== undefined).every((s) => s.sessionUuid === id)).toBe(true);
    },
    CASE_MS * 2,
  );

  it(
    "keeps the user's config: their own hook and MCP server apply beside HiveTTY's (D2)",
    async () => {
      const marker = join(scratch, 'user-hook-ran');
      writeFileSync(
        join(home, 'settings.json'),
        `${JSON.stringify({ hooks: { agentStop: [{ type: 'command', bash: `touch ${marker}` }] } }, null, 2)}\n`,
      );
      writeFileSync(
        join(home, 'mcp-config.json'),
        `${JSON.stringify({ mcpServers: { 'probe-user': { type: 'local', ...stub('probe-user'), tools: ['*'] } } }, null, 2)}\n`,
      );
      // The real host when the desktop build exists, else a stand-in under the same name.
      const host = join(process.cwd(), 'out', 'main', 'mcp-host.js');
      const hiveServer = existsSync(host)
        ? { command: process.execPath, args: [host], env: { ELECTRON_RUN_AS_NODE: '1' } }
        : stub('hive');
      if (!existsSync(host)) console.info('NOTE     ', `${host} is absent: the hive server is a stand-in`);
      const log = await run('config', UUID, { spec: { hiveServer }, prompts: ['Reply ok'], after: ['/mcp list'] });
      finding('config', {});

      expect(existsSync(marker)).toBe(true);
      expect(statuses.some((s) => s.signal?.kind === 'turn-end')).toBe(true);
      expect(flat(log)).toContain('probe-user—connected');
      expect(flat(log)).toContain('hive—connected');
    },
    CASE_MS,
  );

  it(
    'writes nothing in the home but Copilot’s own state',
    async () => {
      writeFileSync(join(home, 'settings.json'), '{\n  "banner": "never"\n}\n');
      writeFileSync(join(home, 'mcp-config.json'), '{\n  "mcpServers": {}\n}\n');
      // The user's two files; `config.json` is Copilot's own ("managed automatically"), and it rewrites it.
      const files = ['settings.json', 'mcp-config.json'];
      const bytes = (): string[] => files.map((file) => readFileSync(join(home, file), 'utf8'));
      const before = bytes();
      const login = (): unknown => readConfig(join(home, 'config.json'))['loggedInUsers'];
      const loginBefore = login();
      const entries = new Set(readdirSync(home));

      await run('home', UUID, { prompts: ['Reply with the single word READY.'] });
      const added = readdirSync(home).filter((entry) => !entries.has(entry));
      finding('home', { added });

      expect(bytes()).toEqual(before);
      expect(login()).toEqual(loginBefore);
      expect(readFileSync(join(home, 'config.json'), 'utf8')).not.toContain(join(scratch, 'state'));
      expect(added).toContain('session-state');
      // HiveTTY's plugin lives in its own state dir, never in the home.
      expect(added.some((entry) => /hivetty|plugin\.json|hooks\.json/i.test(entry))).toBe(false);
      expect(existsSync(join(scratch, 'state', 'plugin', 'hooks', 'hooks.json'))).toBe(true);
    },
    CASE_MS,
  );
});
