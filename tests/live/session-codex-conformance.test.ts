// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { launchCodexSession } from '../../electron/main/harness/codex/launch';
import { codexRecord } from '../../electron/main/harness/codex/record';
import type { LaunchSpec } from '../../electron/main/harness/port';
import { createHarnessRegistry } from '../../electron/main/harness/registry';
import { createReceiver, type Receiver } from '../../electron/main/hooks/receiver';
import { createStatusTracker } from '../../electron/main/hooks/tracker';
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
import type { PlanUpdate } from '../../electron/shared/plan-contract';

/**
 * What only a real interactive `codex` can prove about a Codex session (HIVE-279).
 *
 * The unit suites hold the argv (`launch.test.ts`), the record, and the recorded hook bodies through
 * the receiver. This holds them against the binary on a real pty: the argv is
 * **`launchCodexSession`'s own**, split the way the login shell would, so a flag the TUI refuses
 * fails here. The receiver, tracker and notifier are the real ones `sessions/index.ts` drives, with
 * a registry answering `codex` for the session. The one part of the production line not typed here is
 * the `unset …;` prefix subscription auth adds, which the login shell runs and codex never sees.
 *
 * Every case gets a scratch git repo and a scratch `CODEX_HOME` holding a **copy** of
 * `~/.codex/auth.json`; nothing is written under `~/.codex`. Every ambient `HIVE_*`, `CODEX_*` and
 * `OPENAI_*` is stripped before the case sets its own. Each case writes `finding.json` beside its
 * scratch repo, and logs where.
 *
 * Opt-in: `pnpm test:session:codex`. Skipped unless `codex --version` is 0.164.x and
 * `~/.codex/auth.json` exists; about five minutes.
 */

const LIVE = process.env['HIVE_LIVE_SESSION_CODEX_PROOF'] === '1';
const AUTH = join(homedir(), '.codex', 'auth.json');
const READY =
  LIVE &&
  existsSync(AUTH) &&
  /^codex-cli 0\.164\./.test(spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout ?? '');
const SESSION = 'sess-cx';
const CASE_MS = 240_000;

/**
 * The pty driver, `tests/fixtures/codex/interactive-0.164/probe.py`'s loop. It splits the production
 * line with `shlex` and drops its `&& exit` (the driver is the shell), sizes the pty and
 * answers the TUI's start-up queries as xterm.js does (without either codex draws nothing), types
 * the prompt and its `\r` 300 ms apart (HIVE-63), presses Enter on an approval when asked to, and
 * `/exit`s once the turn reports `Worked for`. Its config is one JSON argument.
 */
const DRIVER = String.raw`
import fcntl, json, os, pty, select, shlex, struct, sys, termios, time
c = json.loads(sys.argv[1])
argv = shlex.split(c['line'])
assert argv[-2:] == ['&&', 'exit'], argv[-2:]
argv = argv[:-2]
Q = [(b'\x1b[6n', b'\x1b[1;1R'),
     (b'\x1b]10;?\x1b\\', b'\x1b]10;rgb:d8d8/d8d8/d8d8\x1b\\'), (b'\x1b]11;?\x1b\\', b'\x1b]11;rgb:1818/1818/1818\x1b\\'),
     (b'\x1b]10;?\x07', b'\x1b]10;rgb:d8d8/d8d8/d8d8\x07'), (b'\x1b]11;?\x07', b'\x1b]11;rgb:1818/1818/1818\x07'),
     (b'\x1b[?u', b'\x1b[?0u'), (b'\x1b[c', b'\x1b[?62;22c')]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(c['cwd'])
    try: os.execvpe(argv[0], argv, c['env'])
    finally: os._exit(127)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
out = bytearray(); replied = 0; start = time.time(); step = 0; submitted = 0; approved = False; done_at = None
while time.time() - start < c['seconds']:
    r, _, _ = select.select([fd], [], [], 0.3)
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
    if step == 0 and now > 8:
        os.write(fd, c['prompt'].encode()); step = 1
    elif step == 1 and now > 8.3:
        os.write(fd, b'\r'); step = 2; submitted = len(out)
    elif step == 2:
        since = bytes(out[submitted:])
        if c['approve'] and not approved and b'Would you like to run' in since:
            time.sleep(0.5); os.write(fd, b'\r'); approved = True
        if done_at is None and b'Worked for' in since: done_at = now
        if done_at is not None and now > done_at + 2:
            os.write(fd, b'/exit'); time.sleep(0.3); os.write(fd, b'\r'); step = 3
    elif step == 3 and now > (done_at or 0) + 8: break
try: os.kill(pid, 9)
except Exception: pass
open(c['log'], 'wb').write(bytes(out))
`;

/** The line `launchCodexSession` types; the driver splits it with `shlex`, as a shell would. */
const lineOf = (spec: Partial<LaunchSpec>): string =>
  launchCodexSession({ command: 'codex', bypassHookTrust: true, ...spec }).command;

/** Escape sequences out, and every space: a TUI wraps and pads what it draws. */
const flat = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\x1b\[[0-9;?<>=]*[a-zA-Z~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]/g, '')
    .replace(/\s+/g, '');

describe.skipIf(!READY)('a real interactive codex session (HIVE-279)', () => {
  let receiver: Receiver;
  let url: string;
  let statuses: Array<{ status: string; signal: HookStatusEvent['signal']; sessionUuid?: string }>;
  let raised: HiveNotification[];
  let plans: PlanUpdate[];
  let scratch: string;
  let repo: string;
  let home: string;

  beforeEach(async () => {
    statuses = [];
    raised = [];
    plans = [];
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'codex-session-live-')));
    repo = join(scratch, 'repo');
    home = join(scratch, 'codex-home');
    mkdirSync(repo);
    mkdirSync(home);
    spawnSync('git', ['init', '-q', repo]);
    copyFileSync(AUTH, join(home, 'auth.json'));

    const tracker = createStatusTracker();
    const hub = createNotificationHub({
      prefs: () => ({}),
      present: () => {},
      broadcast: (n) => raised.push(n),
      activate: () => undefined,
      announceRead: () => undefined,
      announceBadge: () => {},
      announceDismissed: () => undefined,
      now: () => Date.now(),
    });
    const notifier = createNotifier({ hub, isForeground: () => false, isForegroundEverywhere: () => false });
    receiver = createReceiver({
      knowsSession: (id) => id === SESSION,
      knowsAgent: () => false,
      onAgentEvent: () => {},
      harnesses: createHarnessRegistry({ sessionHarness: (id) => (id === SESSION ? 'codex' : undefined) }),
      onEvent: (e) => {
        const derived = tracker.apply({
          entityId: e.entityId,
          signal: e.signal,
          ...(e.toolUseId === undefined ? {} : { toolUseId: e.toolUseId }),
          ...(e.toolName === undefined ? {} : { toolName: e.toolName }),
        });
        const event = {
          entityId: e.entityId,
          status: derived.status,
          signal: e.signal,
          ...(e.sessionUuid === undefined ? {} : { sessionUuid: e.sessionUuid }),
        };
        statuses.push(event);
        notifier.observe(CH.sessionStatus, event as unknown as Record<string, unknown>);
      },
      onPlan: (update) => plans.push(update),
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
    // The evidence stays; the credential copy does not.
    rmSync(join(home, 'auth.json'), { force: true });
  });

  /** The user's own config.toml, in the scratch home: the repo trusted, as a user's own repo is. */
  const userConfig = (extra = ''): void => {
    writeFileSync(join(home, 'config.toml'), `${extra}\n[projects.${JSON.stringify(repo)}]\ntrust_level = "trusted"\n`);
  };

  /** One launch, one prompt, one turn. Resolves with the pty log's path. */
  const run = async (name: string, spec: Partial<LaunchSpec>, prompt: string, approve = false): Promise<string> => {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && !/^(HIVE_|CODEX_|OPENAI_)/.test(entry[0]),
      ),
    );
    Object.assign(env, {
      CODEX_HOME: home,
      TERM: 'xterm-256color',
      [HOOK_ENV_RECEIVER_URL]: url.slice(0, -HOOK_PATH.length),
      [HOOK_ENV_SESSION]: SESSION,
      [HOOK_ENV_TOKEN]: receiver.tokenFor(SESSION),
    });
    const log = join(scratch, `${name}.pty.log`);
    const config = { line: lineOf(spec), env, cwd: repo, prompt, approve, seconds: 180, log };
    const stderr: Buffer[] = [];
    await new Promise<void>((resolve) => {
      const child = spawn('python3', ['-c', DRIVER, JSON.stringify(config)], { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('exit', () => resolve());
    });
    if (stderr.length > 0) console.info('DRIVER   ', Buffer.concat(stderr).toString('utf8'));
    return log;
  };

  const finding = (name: string, body: Record<string, unknown>): void => {
    const path = join(scratch, `${name}.finding.json`);
    writeFileSync(path, JSON.stringify({ statuses, raised: raised.map((n) => n.kind), plans, ...body }, null, 2));
    console.info('EVIDENCE ', path);
  };

  it(
    'reports working, then idle, from its own hooks',
    async () => {
      userConfig();
      /*
        A stand-in hive server, so the argv's most quoted part (`mcp_servers.hive.*`, an inline
        table with a space in a value) goes through the real binary: codex starting it is the proof
        it parsed. The real host needs the desktop build, and the ledger tools are test:agent:codex's.
      */
      const marker = join(scratch, 'hive-mcp-ran');
      const hiveServer = { command: 'sh', args: ['-c', `touch ${marker}; exec cat`], env: { HIVE_PROBE: 'a b' } };
      await run('status', { hiveServer }, 'Reply with the single word READY.');
      finding('status', {});

      const seen = statuses.map((s) => s.status);
      expect(seen).toContain('working');
      const idle = seen.lastIndexOf('idle');
      expect(idle).toBeGreaterThan(seen.indexOf('working'));
      expect(statuses[idle]!.signal.kind).toBe('turn-end');
      expect(existsSync(marker)).toBe(true);
    },
    CASE_MS,
  );

  it(
    'raises a permission card, and needs-you, for a call the user’s config does not allow',
    async () => {
      // FINDINGS P7: on-request in a read-only sandbox is what asks at 0.164.
      userConfig('approval_policy = "on-request"\nsandbox_mode = "read-only"');
      await run(
        'permission',
        {},
        'Run the shell command: touch probe.txt. If the sandbox blocks it, request approval to run it with escalated permissions.',
        true,
      );
      finding('permission', {});

      const waiting = statuses.findIndex((s) => s.status === 'waiting' && s.signal.kind === 'waiting');
      expect(waiting).toBeGreaterThanOrEqual(0);
      expect(statuses[waiting]!.signal).toMatchObject({ reason: 'permission' });
      // The card itself, not the idle every finished turn raises.
      expect(raised.map((n) => n.kind)).toContain('session.blocked');
      // Asked before it ran: the wait comes before the turn's end, and the file exists after it.
      expect(statuses.findLastIndex((s) => s.signal.kind === 'turn-end')).toBeGreaterThan(waiting);
      expect(existsSync(join(repo, 'probe.txt'))).toBe(true);
    },
    CASE_MS,
  );

  it(
    'builds the plan from update_plan, in order',
    async () => {
      userConfig();
      await run(
        'plan',
        {},
        'Use update_plan to make a plan with steps Alpha, Beta, Gamma; mark Alpha in_progress, then completed. Reply DONE.',
      );
      finding('plan', {});

      const last = plans.filter((update) => update.op.kind === 'tasks-replaced').at(-1);
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

  it(
    'resumes by the id its first hook reported, and the conversation continues',
    async () => {
      userConfig();
      await run('resume-1', {}, 'Remember the word HONEYCOMB. Reply OK.');
      const id = statuses.find((s) => s.sessionUuid !== undefined)?.sessionUuid;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      // What `history.resumable` asks before it offers a resume.
      expect(codexRecord(() => home).hasTranscript(repo, id!)).toBe(true);

      // Reversed: the resumed TUI redraws the first turn, and only a remembering model writes this.
      const log = await run(
        'resume-2',
        { sessionUuid: id!, resume: true },
        'What word did I ask you to remember? Reply with it reversed, in lowercase, and nothing else.',
      );
      finding('resume', { id });

      expect(flat(log)).toContain('bmocyenoh');
      expect(statuses.filter((s) => s.sessionUuid !== undefined).every((s) => s.sessionUuid === id)).toBe(true);
    },
    CASE_MS * 2,
  );

  it(
    'keeps the user’s config: their model and their own Stop hook run beside HiveTTY’s (D2)',
    async () => {
      const marker = join(scratch, 'user-hook-ran');
      userConfig(
        `model = "gpt-5.6-terra"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(`touch ${marker}`)}\n`,
      );
      // No model on the argv: the user's applies.
      await run('config', {}, 'Reply with the single word READY.');
      const id = statuses.find((s) => s.sessionUuid !== undefined)?.sessionUuid;
      const rollout = id === undefined ? null : codexRecord(() => home).transcriptPath(repo, id);
      finding('config', { id, rollout });

      expect(existsSync(marker)).toBe(true);
      expect(statuses.some((s) => s.signal.kind === 'turn-end')).toBe(true);
      expect(rollout).not.toBeNull();
      expect(readFileSync(rollout!, 'utf8')).toContain('"model":"gpt-5.6-terra"');
    },
    CASE_MS,
  );
});
