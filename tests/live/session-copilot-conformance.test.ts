// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copilotAdapter } from '../../electron/main/harness/copilot';
import { COPILOT_INSTRUCTIONS_ENV, launchCopilotSession } from '../../electron/main/harness/copilot/launch';
import { copilotRecord } from '../../electron/main/harness/copilot/record';
import type { LaunchSpec } from '../../electron/main/harness/port';
import { createHarnessRegistry } from '../../electron/main/harness/registry';
import { createReceiver, type Receiver } from '../../electron/main/hooks/receiver';
import { createStatusTracker, type StatusTracker } from '../../electron/main/hooks/tracker';
import type { StdioServerSpec } from '../../electron/main/mcp/agent-config';
import { hiveServerSpec } from '../../electron/main/mcp/config';
import { createNotificationHub, createNotifier } from '../../electron/main/notifications';
import { createRecordAborts, type RecordAborts } from '../../electron/main/sessions/record-aborts';
import { readUserSkills } from '../../electron/main/skills/read';
import { renderSkills } from '../../electron/main/skills/render';
import {
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  HOOK_PATH,
  type HookStatusEvent,
} from '../../electron/shared/hook-contract';
import { CH } from '../../electron/shared/ipc-contract';
import type { LedgerReadQuery, LedgerSnapshot } from '../../electron/shared/ledger-contract';
import type { HiveNotification } from '../../electron/shared/notification-contract';
import { typedSkill } from '../../electron/shared/skill-render';

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
const HOST = join(process.cwd(), 'out', 'main', 'mcp-host.js');

/** Every ambient `HIVE_*`, `COPILOT_*`, `GH_TOKEN` and `GITHUB_TOKEN` out. */
const strippedEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !/^(HIVE_|COPILOT_|GH_TOKEN$|GITHUB_TOKEN$)/.test(entry[0]),
    ),
  );

/**
 * The pty driver, `tests/fixtures/copilot/interactive-1.0.105/probe.py`'s loop. It sizes the pty
 * and answers the TUI's start-up queries as xterm.js does, types the prompt and its `\r` 300 ms
 * apart (HIVE-63), and answers Copilot's own approval prompt with `answer` when given. It ends the
 * turn's drive when the test writes `stop` (a turn-end reached the receiver) or, after an Esc, when
 * the TUI says the operation was cancelled; then types `after`, and `/exit`s, or kills the process
 * and waits for it to be gone (`kill`). A "Session in use" dialog is answered "Resume anyway".
 * Every key it types is printed as a JSON line before it is written, for the test to read as the
 * user's. `interrupt` types Esc Esc that many seconds after the submit, Copilot's own interrupt, and
 * gives the record six seconds before moving on (HIVE-365).
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
    # Reported before it is written, as ptyWrite reads the record's size before the write.
    print(json.dumps({'key': text}), flush=True); time.sleep(0.1); os.write(fd, text.encode())
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
    if c.get('interrupt'):
        pump(c['interrupt']); key('\x1b'); pump(0.15); key('\x1b'); pump(6)
        continue
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
elif c.get('exitRaw'):
    # As sessions/index.ts writes EXIT_COMMAND: one write, no pause before the CR.
    print(json.dumps({'key': '/exit\r'}), flush=True); os.write(fd, b'/exit\r')
    alive = pump(8)
    print(json.dumps({'exited': not alive}), flush=True)
    try: os.kill(pid, 9); os.waitpid(pid, 0)
    except Exception: pass
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
  let aborts: RecordAborts;
  let transcript: { cwd: string; sessionUuid: string } | undefined;
  let source: string;
  let rendered: string;
  let tools: string[];
  let done: string[];
  let ledgerRead: (caller: string, query: LedgerReadQuery) => LedgerSnapshot;

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

    // HiveTTY's own skills plus two probes, rendered for Copilot as the app renders them (HIVE-362).
    source = join(scratch, 'skills-src');
    cpSync(join(process.cwd(), 'resources', 'skills'), source, { recursive: true });
    const probe = (name: string, word: string): void => {
      mkdirSync(join(source, name));
      writeFileSync(
        join(source, name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: A HiveTTY live probe.\n---\nReply with the single word ${word} and nothing else.\n`,
      );
    };
    probe('zz-plain', 'marmalade');
    probe('zz-collide', 'quince');
    // The user's own skill of the same name: Copilot must then name ours hive:zz-collide (fact 2).
    mkdirSync(join(home, 'skills', 'zz-collide'), { recursive: true });
    writeFileSync(
      join(home, 'skills', 'zz-collide', 'SKILL.md'),
      "---\nname: zz-collide\ndescription: The user's own.\n---\nReply with the single word turnip and nothing else.\n",
    );
    rendered = join(scratch, 'plugins', 'copilot');
    await renderSkills(rendered, 'copilot', await readUserSkills(source), { version: '0.0.0-live', doneUrl: null });

    tools = [];
    done = [];
    ledgerRead = () => ({ entries: [], openAsks: [], claims: {} });

    tracker = createStatusTracker();
    transcript = undefined;
    // The real watch `sessions/index.ts` runs, on this case's scratch home.
    aborts = createRecordAborts({
      transcriptOf: () => transcript,
      adapterOf: () => ({ ...copilotAdapter, record: copilotRecord(() => home) }),
      busy: (id) => tracker.busy(id),
      onAbort: (id) => {
        const derived = tracker.abort(id);
        if (derived !== undefined) observe(derived.status);
      },
    });
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
        if (e.toolName !== undefined) tools.push(e.toolName);
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
      onDone: (id) => done.push(id),
      onReady: () => {},
      onMetrics: () => {},
      onLedgerRead: (caller, query) => ledgerRead(caller, query),
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

  /** The real hive server, from the desktop build. */
  const hive = (): StdioServerSpec => {
    if (!existsSync(HOST)) {
      throw new Error(`${HOST} is missing. Run \`pnpm desktop:build\` before \`pnpm test:session:copilot\`.`);
    }
    return hiveServerSpec({ execPath: process.execPath, scriptPath: HOST });
  };

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
    interrupt?: number;
    /** `/exit\r` in one write, as `EXIT_COMMAND` is, and report whether copilot exited. */
    exitRaw?: boolean;
  }

  /** One launch, its prompts, one turn each. Resolves with the pty log's path, and whether `exitRaw` exited. */
  const run = async (name: string, sessionUuid: string, drive: Drive): Promise<{ log: string; exited: boolean }> => {
    const plan = launchCopilotSession({ command: 'copilot', sessionUuid, stateDir: join(scratch, 'state'), ...drive.spec });
    // As the core does, before the first keystroke.
    for (const file of plan.files ?? []) {
      mkdirSync(join(file.path, '..'), { recursive: true });
      writeFileSync(file.path, file.text);
    }
    const head = 'unset COPILOT_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN COPILOT_ALLOW_ALL COPILOT_ASSISTED_APPROVAL; ';
    expect(plan.command.startsWith(head)).toBe(true);
    expect(plan.command.endsWith(' && exit')).toBe(true);
    const split = spawnSync('python3', ['-c', 'import json,shlex,sys; print(json.dumps(shlex.split(sys.argv[1])))', plan.command.slice(head.length, -' && exit'.length)], {
      encoding: 'utf8',
    });
    const argv = JSON.parse(split.stdout) as string[];

    const env = strippedEnv();
    // The instructions prefix, expanded as the login shell would with no user value (all COPILOT_* are stripped).
    const assign = /^([A-Z_]+)=(.*)$/s.exec(argv[0] ?? '');
    if (assign !== null) {
      argv.shift();
      env[assign[1]!] = assign[2]!.replace(`\${${COPILOT_INSTRUCTIONS_ENV}:+$${COPILOT_INSTRUCTIONS_ENV},}`, '');
    }
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
    transcript = { cwd: repo, sessionUuid };
    let exited = false;
    await new Promise<void>((resolve) => {
      const child = spawn('python3', ['-c', DRIVER, JSON.stringify(config)], { stdio: ['ignore', 'pipe', 'pipe'] });
      // Each key the driver types reaches the session as the user's, as `ptyWrite` does (`sessions/index.ts`).
      createInterface({ input: child.stdout }).on('line', (line) => {
        const parsed = JSON.parse(line) as { key?: string; exited?: boolean };
        if (parsed.exited !== undefined) {
          exited = parsed.exited;
          return;
        }
        const typed = parsed.key ?? '';
        void aborts.onKey(SESSION, typed);
        const answer = copilotAdapter.answersBlock?.(typed) ?? null;
        if (answer === null) return;
        const derived = tracker.release(SESSION, { endTurn: answer === 'cancelled' });
        if (derived !== undefined) observe(derived.status);
      });
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('exit', () => resolve());
    });
    aborts.drop(SESSION);
    if (stderr.length > 0) console.info('DRIVER   ', Buffer.concat(stderr).toString('utf8'));
    return { log, exited };
  };

  const finding = (name: string, body: Record<string, unknown>): void => {
    const path = join(scratch, `${name}.finding.json`);
    writeFileSync(
      path,
      JSON.stringify({ statuses, raised: raised.map((n) => n.kind), dismissed, tools, done, ...body }, null, 2),
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
    'ends the turn on an Esc Esc interrupt, which fires no agentStop (HIVE-365)',
    async () => {
      // Ten seconds in, the reply is streaming. Four seconds in (1.0.105), Copilot had not started it:
      // its first Esc offered "Esc again to edit prompt" and the pair wrote no abort.
      await run('interrupt', UUID, { prompts: ['Write a 600-word essay about bees, then reply DONE.'], interrupt: 10 });
      finding('interrupt', {});

      expect(statuses.some((s) => s.status === 'working')).toBe(true);
      // Copilot's own abort in events.jsonl ended it; a finished essay would have ended on agentStop.
      expect(statuses.at(-1)?.status).toBe('idle');
      expect(statuses.at(-1)?.signal).toBeUndefined();
      expect(statuses.some((s) => s.signal?.kind === 'turn-end')).toBe(false);
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
      const hiveServer = existsSync(HOST)
        ? hiveServerSpec({ execPath: process.execPath, scriptPath: HOST })
        : stub('hive');
      if (!existsSync(HOST)) console.info('NOTE     ', `${HOST} is absent: the hive server is a stand-in`);
      const { log } = await run('config', UUID, { spec: { hiveServer }, prompts: ['Reply ok'], after: ['/mcp list'] });
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

  it(
    'loads a HiveTTY skill typed /hive:<name>, whether or not the bare name collides (HIVE-362)',
    async () => {
      const id = '11111111-2222-4333-8444-5555555555c1';
      const { log } = await run('typed-form', id, {
        spec: { pluginDir: rendered },
        prompts: ['/hive:zz-plain', '/hive:zz-collide'],
      });
      finding('typed-form', { log });
      // From the transcript: the TUI's spinner interleaves its frames with the reply it draws.
      const replies = readFileSync(copilotRecord(() => home).transcriptPath(repo, id)!, 'utf8');
      expect(replies).toContain('marmalade');
      expect(replies).toContain('quince');
      expect(replies).not.toContain('turnip');
    },
    CASE_MS,
  );

  it(
    '/hive:done finishes through session_done with no permission prompt, and the typed /exit closes copilot (HIVE-362, HIVE-368)',
    async () => {
      const { log, exited } = await run('done', '11111111-2222-4333-8444-5555555555c2', {
        spec: { pluginDir: rendered, hiveServer: hive() },
        prompts: [typedSkill('done', 'copilot')],
        exitRaw: true,
      });
      finding('done', { log, exited });
      expect(done).toEqual([SESSION]);
      expect(tools.some((t) => /session_done/.test(t))).toBe(true);
      expect(statuses.some((s) => s.status === 'waiting')).toBe(false);
      expect(flat(log)).not.toContain('Doyouwant');
      expect(exited).toBe(true);
    },
    CASE_MS,
  );

  it(
    'a ticket session types the rendered work-on and the model follows it to hive-jira_get (HIVE-362)',
    async () => {
      // ticketWorkflowStart is what the core types; its first step names the Hive's jira tool.
      const { log } = await run('work-on', '11111111-2222-4333-8444-5555555555c3', {
        spec: { pluginDir: rendered, hiveServer: hive() },
        prompts: [`${typedSkill('work-on', 'copilot')} HIVE-1`],
        answer: '\x1b',
      });
      finding('work-on', { log });
      expect(tools.some((t) => /jira_get/.test(t))).toBe(true);
    },
    CASE_MS,
  );

  it('lists every HiveTTY skill from its --plugin-dir, none refused (HIVE-362, HIVE-369)', () => {
    const listed = spawnSync('copilot', ['--plugin-dir', rendered, 'skill', 'list', '--json'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...strippedEnv(), COPILOT_HOME: home },
    });
    finding('skill-list', { stdout: listed.stdout, stderr: listed.stderr });
    // The JSON array first; a refused skill is reported in prose after it.
    const json = listed.stdout.slice(0, listed.stdout.lastIndexOf(']') + 1);
    const ours = (JSON.parse(json) as Array<{ name: string; source: string }>)
      .filter((s) => s.source === 'plugin')
      .map((s) => s.name.replace(/^hive:/, ''));
    // Every rendered skill loads: a frontmatter Copilot's YAML refuses is dropped from the list (HIVE-369).
    expect(ours.sort()).toEqual(readdirSync(join(rendered, 'skills')).sort());
    expect(`${listed.stdout}${listed.stderr}`).not.toMatch(/failed to load/i);
  });
});
