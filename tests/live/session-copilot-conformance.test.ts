// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copilotAdapter } from '../../electron/main/harness/copilot';
import { shellQuote } from '../../electron/main/container/shell-quote';
import {
  COPILOT_INSTRUCTIONS_ENV,
  COPILOT_OTEL_EXPORT_ENV,
  COPILOT_OTEL_USER_KEYS,
  launchCopilotSession,
} from '../../electron/main/harness/copilot/launch';
import { copilotRecord } from '../../electron/main/harness/copilot/record';
import type { LaunchSpec } from '../../electron/main/harness/port';
import { createHarnessRegistry } from '../../electron/main/harness/registry';
import { createReceiver, type Receiver } from '../../electron/main/hooks/receiver';
import { createStatusTracker, type StatusTracker } from '../../electron/main/hooks/tracker';
import { createLedger } from '../../electron/main/ledger';
import type { StdioServerSpec } from '../../electron/main/mcp/agent-config';
import { hiveServerSpec } from '../../electron/main/mcp/config';
import { createNotificationHub, createNotifier } from '../../electron/main/notifications';
import { meterExportPath } from '../../electron/main/sessions/meter-exports';
import { createRecordAborts, type RecordAborts } from '../../electron/main/sessions/record-aborts';
import { createRecordMeters, METER_EXPORT_SETTLE_MS, type RecordMeters } from '../../electron/main/sessions/record-meters';
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
import type { SessionMetrics, SessionMetricsEvent } from '../../electron/shared/metrics-contract';
import type { LedgerEntry, LedgerReadQuery, LedgerSnapshot, OpenAsk } from '../../electron/shared/ledger-contract';
import type { HiveNotification } from '../../electron/shared/notification-contract';
import type { PlanUpdate } from '../../electron/shared/plan-contract';
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

/** Every ambient `HIVE_*`, `COPILOT_*`, `OTEL_*` (HIVE-335), `GH_TOKEN` and `GITHUB_TOKEN` out. */
const strippedEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !/^(HIVE_|COPILOT_|OTEL_|GH_TOKEN$|GITHUB_TOKEN$)/.test(entry[0]),
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
for text in c.get('before', []):
    key(text); pump(0.3); key('\r'); pump(3)
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
  /** HIVE-335: the real export reader `sessions/index.ts` runs, and every metrics payload it sent. */
  let meters: RecordMeters;
  let metrics: SessionMetrics[];
  let exportFile: string;
  let transcript: { cwd: string; sessionUuid: string } | undefined;
  let source: string;
  let rendered: string;
  let tools: string[];
  let done: string[];
  let ledgerRead: (caller: string, query: LedgerReadQuery) => LedgerSnapshot;
  /** HIVE-370: a real ledger behind `onLedgerPost`, so goal-on's receipts land. */
  let ledger: ReturnType<typeof createLedger>;
  /** HIVE-370: goal-on's briefs, inside the repo; every run's verifier reads here, never ~/.hivetty. */
  let goals: string;
  /** HIVE-361: every plan the receiver read, from the session's own sql todo list. */
  let plans: PlanUpdate[];

  beforeEach(async () => {
    plans = [];
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
    goals = join(repo, '.goals');
    mkdirSync(goals);
    ledger = createLedger({ dir: join(scratch, 'hive'), knowsParty: () => true });
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
    // The user's own skill of the same name (not read from a scratch home, fact 2; HIVE-382 names ours hive-zz-collide).
    mkdirSync(join(home, 'skills', 'zz-collide'), { recursive: true });
    writeFileSync(
      join(home, 'skills', 'zz-collide', 'SKILL.md'),
      "---\nname: zz-collide\ndescription: The user's own.\n---\nReply with the single word turnip and nothing else.\n",
    );
    // The repository's own skill of the same name, in each root Copilot reads one from. Before HIVE-382
    // any one of them hid ours outright (FINDINGS P10); rendered as hive-zz-repo, ours cannot collide.
    probe('zz-repo', 'damson');
    for (const [root, word] of [['.github', 'persimmon'], ['.agents', 'loquat'], ['.claude', 'tamarillo']] as const) {
      mkdirSync(join(repo, root, 'skills', 'zz-repo'), { recursive: true });
      writeFileSync(
        join(repo, root, 'skills', 'zz-repo', 'SKILL.md'),
        `---\nname: zz-repo\ndescription: The repository's own.\n---\nReply with the single word ${word} and nothing else.\n`,
      );
    }
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
    metrics = [];
    exportFile = meterExportPath(join(scratch, 'state'), SESSION) ?? '';
    meters = createRecordMeters({
      send: (_channel, payload) => metrics.push((payload as SessionMetricsEvent).metrics),
      transcriptOf: () => transcript,
      adapterOf: () => copilotAdapter,
      exportPathOf: () => exportFile,
    });
    observe = (status, signal, sessionUuid) => {
      const event = {
        entityId: SESSION,
        status,
        ...(signal === undefined ? {} : { signal }),
        ...(sessionUuid === undefined ? {} : { sessionUuid }),
      };
      statuses.push(event);
      notifier.observe(CH.sessionStatus, event as unknown as Record<string, unknown>);
      // As the core does on every hook: a meters read, and for Copilot one trailing read (HIVE-335).
      void meters.onHook(SESSION);
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
      onPlan: (update) => plans.push(update),
      onTicketIntent: () => undefined,
      onPromptName: () => {},
      onCleared: () => undefined,
      onDone: (id) => done.push(id),
      onReady: () => {},
      onMetrics: () => {},
      onLedgerRead: (caller, query) => ledgerRead(caller, query),
      onLedgerPost: (caller, request) => ledger.append({ ...request, from: caller }),
      onAgentsList: () => Promise.reject(new Error('not exercised by this suite')),
    });
    const started = await receiver.start();
    expect(started).not.toBeNull();
    url = started as string;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
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
    /** Typed and submitted before the prompts, three seconds each: a slash command that ends no turn. */
    before?: string[];
    kill?: boolean;
    interrupt?: number;
    /** `/exit\r` in one write, as `EXIT_COMMAND` is, and report whether copilot exited. */
    exitRaw?: boolean;
    /** The file whose appearance ends a prompt's wait; the first turn end's by default. */
    stop?: string;
    /** How long the drive may run, 180 s by default. */
    seconds?: number;
    /** Extra env for the session's shell, as a user's profile would set it (HIVE-335). */
    env?: Record<string, string>;
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
    let rest = plan.command.slice(head.length, -' && exit'.length);
    const env = strippedEnv();
    Object.assign(env, drive.env ?? {});
    // HIVE-335: the OTel guard, a statement of its own; applied as the login shell would.
    const exportPath = drive.spec?.exportPath;
    if (rest.startsWith('[ -n "')) {
      const end = rest.indexOf('; ') + '; '.length;
      expect(exportPath).toBeDefined();
      expect(rest.slice(0, end)).toBe(
        `[ -n "${COPILOT_OTEL_USER_KEYS.map((key) => `\${${key}:-}`).join('')}" ] || export ${COPILOT_OTEL_EXPORT_ENV}=${shellQuote(exportPath ?? '')}; `,
      );
      rest = rest.slice(end);
      if (exportPath !== undefined) {
        mkdirSync(dirname(exportPath), { recursive: true });
        if (COPILOT_OTEL_USER_KEYS.every((key) => (env[key] ?? '') === '')) env[COPILOT_OTEL_EXPORT_ENV] = exportPath;
      }
    }
    const split = spawnSync('python3', ['-c', 'import json,shlex,sys; print(json.dumps(shlex.split(sys.argv[1])))', rest], {
      encoding: 'utf8',
    });
    const argv = JSON.parse(split.stdout) as string[];

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
      HIVE_GOALS_DIR: goals,
    });
    const log = join(scratch, `${name}.pty.log`);
    const { env: _driveEnv, ...driven } = drive;
    const config = { argv, env, cwd: repo, seconds: 180, log, stop, ...driven };
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
    // HIVE-335: the turn's spans land just after its hook; let the trailing read see them. Real timers: a live suite.
    await new Promise((resolve) => setTimeout(resolve, METER_EXPORT_SETTLE_MS + 500));
    meters.drop(SESSION);
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

  /*
    HIVE-361, FINDINGS P4: Copilot's todo list is a table in session-state/<id>/session.db that its sql
    tool writes one statement at a time. The receiver reads the main process's COPILOT_HOME, so the
    case points it at the session's scratch home, as a user's own COPILOT_HOME would be.
  */
  it(
    'builds the plan from its sql todo list, in order (HIVE-361)',
    async () => {
      vi.stubEnv('COPILOT_HOME', home);
      await run('plan', '11111111-2222-4333-8444-5555555555f1', {
        prompts: [
          'Use your sql tool to keep a todo list: insert todos Alpha, Beta, Gamma, all pending, in one call; ' +
            'then, in a second call, set Alpha to done. Reply DONE.',
        ],
      });
      finding('plan', { plans });

      const last = plans.filter((update) => update.op.kind === 'tasks-replaced').at(-1);
      expect(last).toMatchObject({ entityId: SESSION, cwd: repo });
      expect(last?.op).toMatchObject({
        kind: 'tasks-replaced',
        tasks: [
          { title: 'Alpha', status: 'completed' },
          { title: 'Beta', status: 'pending' },
          { title: 'Gamma', status: 'pending' },
        ],
      });
    },
    CASE_MS,
  );

  /*
    HIVE-370, FINDINGS P13 (copilot 1.0.105): agentStop runs goal-on's verifier after the status hook,
    and Copilot continues the turn on its block. The brief is written before the spawn, as Phase 1
    would have left it, named by the session's HIVE_SESSION_ID. Every agentStop ends a turn for the
    status hook, so the drive waits for the brief to settle instead. No subagent case: driving one
    from the TUI is not cheap, and `hooks-1.0.104/agent-stop-subagent.json` plus the unit test cover it.
  */
  it(
    'meters a real turn from its OTel export with no second hook (HIVE-335)',
    async () => {
      await run('meters', '11111111-2222-4333-8444-5555555555e1', {
        spec: { exportPath: exportFile },
        prompts: ['Reply with the single word READY.'],
      });
      finding('meters', { metrics, exportFile });
      const last = Object.assign({}, ...metrics) as SessionMetrics;
      expect(typeof last.model).toBe('string');
      expect(last.tokensIn).toBeGreaterThan(0);
      expect(last.tokensOut).toBeGreaterThan(0);
      expect(last.aiCredits).toBeGreaterThan(0);
      // The follow-up: context from the turn's usage_info, the gauge `/context` shows.
      expect(last.contextWindow).toBeGreaterThan(0);
      expect(last.contextPct).toBeGreaterThanOrEqual(0);
      expect(last.contextPct).toBeLessThanOrEqual(100);
    },
    CASE_MS,
  );

  it(
    'a subagent’s own context stays out of the session’s (HIVE-335 follow-up)',
    async () => {
      await run('meters-subagent', '11111111-2222-4333-8444-5555555555e4', {
        spec: { exportPath: exportFile },
        prompts: [
          'Use the task tool to run the explore agent with the prompt "Reply with the single word FOUND." Then reply with the single word DONE.',
        ],
        seconds: 240,
      });
      type Time = [number, number];
      type Event = { name: string; time: Time; attributes: Record<string, number> };
      const spans = readFileSync(exportFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string; name?: string; parentSpanId?: string; startTime: Time; endTime: Time; events?: Event[] })
        // `invoke_agent` for the session, `invoke_agent explore` for the subagent (measured, 1.0.105).
        .filter((record) => record.type === 'span' && record.name?.startsWith('invoke_agent') === true);
      const ms = ([sec, nanos]: Time) => sec * 1e3 + nanos / 1e6;
      const nested = spans.filter((record) => record.parentSpanId !== undefined);
      const inside = (event: Event) => nested.some((span) => ms(event.time) >= ms(span.startTime) && ms(event.time) <= ms(span.endTime));
      const readings = spans
        .filter((record) => record.parentSpanId === undefined)
        .flatMap((record) => record.events ?? [])
        .filter((event) => event.name === 'github.copilot.session.usage_info');
      const main = readings.filter((event) => !inside(event)).at(-1);
      finding('meters-subagent', { metrics, readings, nested: nested.map((span) => [span.name, span.startTime, span.endTime]) });
      // The premise, as measured: the subagent runs as a nested invoke_agent, and its own reading lands
      // on the session's span inside that window.
      expect(nested.length).toBeGreaterThan(0);
      expect(readings.some(inside)).toBe(true);
      expect(main).toBeDefined();
      const limit = main!.attributes['github.copilot.token_limit']!;
      const current = main!.attributes['github.copilot.current_tokens']!;
      const last = Object.assign({}, ...metrics) as SessionMetrics;
      expect(last.contextWindow).toBe(limit);
      expect(last.contextPct).toBe(Math.min(100, Math.floor((current / limit) * 100)));
    },
    CASE_MS,
  );

  it(
    'a resume on the same session appends, and the totals grow (HIVE-335)',
    async () => {
      const uuid = '11111111-2222-4333-8444-5555555555e2';
      await run('meters-1', uuid, { spec: { exportPath: exportFile }, prompts: ['Reply with the single word ONE.'] });
      const first = (Object.assign({}, ...metrics) as SessionMetrics).tokensIn ?? 0;
      expect(first).toBeGreaterThan(0);
      // A fresh reader, as after an app restart: run() dropped it, so it rebuilds the totals from the whole file.
      metrics.length = 0;
      await run('meters-2', uuid, {
        spec: { exportPath: exportFile, resume: true },
        prompts: ['Reply with the single word TWO.'],
      });
      finding('meters-resume', { first, metrics });
      expect((Object.assign({}, ...metrics) as SessionMetrics).tokensIn).toBeGreaterThan(first);
    },
    CASE_MS * 2,
  );

  it(
    'leaves the user’s own OTel endpoint alone: no export is written (HIVE-335)',
    async () => {
      await run('meters-user-otel', '11111111-2222-4333-8444-5555555555e3', {
        spec: { exportPath: exportFile },
        // An https endpoint nobody answers: Copilot drops the export and carries on.
        env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://127.0.0.1:9' },
        prompts: ['Reply with the single word READY.'],
      });
      finding('meters-user-otel', { metrics });
      expect(statuses.map((s) => s.status)).toContain('idle');
      expect(existsSync(exportFile)).toBe(false);
      expect(metrics).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'holds a turn end on an unticked Outcome, releases once it is ticked, and posts receipts (HIVE-370)',
    async () => {
      plainRepo();
      const GOAL_UUID = '11111111-2222-4333-8444-5555555555e1';
      const path = join(goals, `${SESSION}.md`);
      writeFileSync(
        path,
        [
          '---',
          'status: ACTIVE',
          'route: artifact',
          'turns_used: 0',
          'turn_budget: 3',
          `session: ${SESSION}`,
          '---',
          '',
          '## Task',
          'Prove the goal verifier holds a Copilot turn.',
          '',
          '## Outcome',
          `- [ ] proof.txt in the working directory says OK, and this box is ticked in ${path}`,
          '',
          '## Verification evidence',
          '$ cat proof.txt',
          'OK',
          '',
        ].join('\n'),
      );
      const settled = join(scratch, 'goal-settled');
      const watch = setInterval(() => {
        if (/^status: (DONE|FAILED)$/m.test(readFileSync(path, 'utf8'))) writeFileSync(settled, '');
      }, 500);
      try {
        await run('goal', GOAL_UUID, {
          spec: { pluginDir: rendered },
          before: ['/allow-all'],
          // Copilot's model otherwise reaches for hive-tdd and a question first, past the drive's budget.
          prompts: [
            'Reply with the word hi and nothing else. If a hook then holds the turn, do exactly what it asks: no tests, no questions.',
          ],
          stop: settled,
          seconds: 400,
        });
      } finally {
        clearInterval(watch);
      }
      const after = readFileSync(path, 'utf8');
      const receipts = ledger
        .read({})
        .entries.filter((e) => e.kind === 'event' && (e.meta as { goal?: string } | undefined)?.goal !== undefined);
      finding('goal', { after, receipts: receipts.map((e) => e.body) });
      expect(after).toMatch(new RegExp(`^cli_session: ${GOAL_UUID}$`, 'm')); // the hook ran and bound the brief
      expect(after).toMatch(/^turns_used: [1-3]$/m); // it blocked at least once
      expect(after).toMatch(/^status: DONE$/m); // and released on a ticked Outcome
      expect(readFileSync(join(repo, 'proof.txt'), 'utf8').trim()).toBe('OK');
      expect(receipts.map((e) => (e.meta as { status: string }).status)).toEqual(
        expect.arrayContaining(['ACTIVE', 'DONE']),
      );
    },
    CASE_MS * 2,
  );

  const blocks = (): number => raised.filter((n) => n.kind === 'session.blocked').length;
  const prompts = (log: string): number => flat(log).split('Doyouwant').length - 1;
  /** beforeEach's repository skills answer any prompt with a word; a shell probe needs them gone. */
  const plainRepo = (): void => {
    for (const root of ['.github', '.agents', '.claude']) rmSync(join(repo, root), { recursive: true, force: true });
  };

  it(
    'raises a permission card and needs-you for a shell call; approving clears both',
    async () => {
      plainRepo();
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
      plainRepo();
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

  /*
   * FINDINGS P12 (HIVE-383): every approval the user makes themselves fires permissionRequest the way
   * --allow-tool does (P11), with no prompt drawn. The card comes only from the permission_prompt
   * notification Copilot sends for a prompt it drew (HIVE-385), so none of these raises one.
   */
  it(
    "a call the user approved with \"don't ask again in this repo\" raises no card; the prompt drawn before it does (FINDINGS P12)",
    async () => {
      plainRepo();
      // A redirect gets only Yes/No; a plain command gets the don't-ask-again option, 2.
      const { log } = await run('p12-repo-approval', '11111111-2222-4333-8444-5555555555d1', {
        prompts: ['Run the shell command: mkdir one', 'Run the shell command: mkdir two'],
        answer: '2',
      });
      finding('p12-repo-approval', { log });
      // Kept on disk per repository: the user's own allow-list.
      const saved = readFileSync(join(home, 'permissions-config.json'), 'utf8');
      expect(saved).toContain(repo);
      expect(saved).toContain('"mkdir"');
      expect(existsSync(join(repo, 'two'))).toBe(true);
      expect(prompts(log)).toBe(1);
      expect(blocks()).toBe(1);
    },
    CASE_MS,
  );

  it(
    '/allow-all typed in the TUI raises no card for the calls it approves (FINDINGS P12)',
    async () => {
      plainRepo();
      const { log } = await run('p12-allow-all', '11111111-2222-4333-8444-5555555555d2', {
        before: ['/allow-all'],
        prompts: ['Run the shell command: echo hive > made.txt'],
      });
      finding('p12-allow-all', { log });
      expect(flat(log)).toContain('AllowAllforthissession');
      expect(existsSync(join(repo, 'made.txt'))).toBe(true);
      expect(prompts(log)).toBe(0);
      expect(blocks()).toBe(0);
    },
    CASE_MS,
  );

  it(
    "settings.json's defaultPermissionMode allow-all raises no card (FINDINGS P12)",
    async () => {
      plainRepo();
      // Where `copilot config defaultPermissionMode allow-all` writes it (probed): settings.json, not config.json.
      writeFileSync(join(home, 'settings.json'), `${JSON.stringify({ defaultPermissionMode: 'allow-all' })}\n`);
      const { log } = await run('p12-settings', '11111111-2222-4333-8444-5555555555d3', {
        prompts: ['Run the shell command: echo hive > made.txt'],
      });
      finding('p12-settings', { log });
      expect(existsSync(join(repo, 'made.txt'))).toBe(true);
      expect(prompts(log)).toBe(0);
      expect(blocks()).toBe(0);
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
    'loads a HiveTTY skill typed /hive:hive-<name>, an argument after it or not, beside a personal or repository skill of its bare name (HIVE-362, HIVE-382)',
    async () => {
      const id = '11111111-2222-4333-8444-5555555555c1';
      const { log } = await run('typed-form', id, {
        spec: { pluginDir: rendered },
        // An argument after two of them: a skill whose own name holds a colon resolves only without one (FINDINGS P10).
        prompts: [typedSkill('hive:zz-plain', 'copilot'), `${typedSkill('hive:zz-collide', 'copilot')} now`, `${typedSkill('hive:zz-repo', 'copilot')} now`],
      });
      finding('typed-form', { log });
      // From the transcript: the TUI's spinner interleaves its frames with the reply it draws.
      const replies = readFileSync(copilotRecord(() => home).transcriptPath(repo, id)!, 'utf8');
      expect(replies).toContain('marmalade');
      expect(replies).toContain('quince');
      expect(replies).not.toContain('turnip');
      expect(replies).toContain('damson');
      for (const theirs of ['persimmon', 'loquat', 'tamarillo']) expect(replies).not.toContain(theirs);
    },
    CASE_MS,
  );

  it(
    '/hive:done finishes through session_done with no permission prompt, and the typed /exit closes copilot (HIVE-362, HIVE-368)',
    async () => {
      const { log, exited } = await run('done', '11111111-2222-4333-8444-5555555555c2', {
        spec: { pluginDir: rendered, hiveServer: hive() },
        prompts: [typedSkill('hive:done', 'copilot')],
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
        prompts: [`${typedSkill('hive:work-on', 'copilot')} HIVE-1`],
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
    const plugin = (JSON.parse(json) as Array<{ name: string; source: string }>).filter((s) => s.source === 'plugin');
    // Every one named hive-<name>, so a repository's zz-repo hides none of them (HIVE-382).
    expect(plugin.every((s) => s.name.startsWith('hive-'))).toBe(true);
    const ours = plugin.map((s) => s.name.replace(/^hive-/, ''));
    // Every rendered skill loads: a frontmatter Copilot's YAML refuses is dropped from the list (HIVE-369).
    expect(ours.sort()).toEqual(readdirSync(join(rendered, 'skills')).sort());
    expect(`${listed.stdout}${listed.stderr}`).not.toMatch(/failed to load/i);
  });

  it(
    'a typed marker reaches the model: it reads the entry with hive-ledger_read and acts on it (HIVE-362)',
    async () => {
      const ask: LedgerEntry = {
        id: 'e-live-1',
        ts: Date.now(),
        from: 'overmind',
        to: SESSION,
        kind: 'ask',
        ref: 'a1',
        body: 'Reply with the single word kumquat and nothing else.',
      };
      ledgerRead = () => ({ entries: [ask], openAsks: [{ ...ask, kind: 'ask', open: true, ageMs: 0, state: 'open' } satisfies OpenAsk], claims: {} });
      const id = '11111111-2222-4333-8444-5555555555c4';
      const { log } = await run('marker', id, {
        spec: { pluginDir: rendered, hiveServer: hive() },
        // The bytes deliver.ts writes, without the CR the driver adds itself.
        prompts: [copilotAdapter.promptMarker([ask]).replace(/\r$/, '')],
        answer: '\r',
      });
      finding('marker', { log });
      expect(tools.some((t) => /ledger_read/.test(t))).toBe(true);
      // From the transcript: the TUI's spinner interleaves its frames with the reply it draws.
      expect(readFileSync(copilotRecord(() => home).transcriptPath(repo, id)!, 'utf8')).toContain('kumquat');
    },
    CASE_MS,
  );
});
