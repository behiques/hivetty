// @vitest-environment node
import { type ChildProcess, execFileSync, fork as nodeFork, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createPtyHostSupervisor,
  type HostChild,
  type PtyHostSupervisor,
} from '../../core/pty-host/supervisor';
import { forkPtyHost, type HostUser } from '../../server/pty-host-fork';
import { CRASH_LIMIT, type HostMessage, SHUTDOWN_TIMEOUT_MS } from '../../shared/pty-host-protocol';

/**
 * The PTY host, run for real under both of its parents (HIVE-423), driven by the real supervisor from source.
 *
 * - **fork**: the server's own `forkPtyHost` on `out/server/pty-host.js` (built by `pnpm server:build`), under
 *   `HIVE_SERVER_NODE` or this process's Node.
 * - **utilityProcess**: `tests/support/utility-host-bridge.mjs`, a real Electron main that forks
 *   `out/main/pty-host.js` (built by `electron-vite build`) with `utilityProcess.fork` and relays it to this process
 *   over Node's IPC channel (`process.send` in the Electron main). One relay hop the app does not have; the app's
 *   own path is the e2e suite's.
 *
 * Cases 1 to 7 run on both hosts; 8 and 9 are the fork host's alone (9 needs root, so it first runs in HIVE-425's
 * Linux CI); 10 runs the `/proc` reader inside a slim Linux image with no `ps`, when Docker is up.
 *
 * `pnpm test:pty-host` builds both hosts and sets `HIVE_LIVE_PTY_HOST_PROOF=1`. `HIVE_PTY_HOST_KINDS` (comma-separated,
 * default `fork,utilityProcess`) picks the hosts. The `Server` workflow runs the fork leg on Linux, case 9 as root
 * (HIVE-425); the Electron leg stays local, since those jobs never download Electron.
 */
const RUN = process.env['HIVE_LIVE_PTY_HOST_PROOF'] === '1';
const ROOT = join(import.meta.dirname, '../..');
const FORK_ENTRY = join(ROOT, 'out/server/pty-host.js');
const UTILITY_ENTRY = join(ROOT, 'out/main/pty-host.js');
const BRIDGE = join(ROOT, 'tests/support/utility-host-bridge.mjs');
const CASE_MS = 30_000;
const KINDS = (process.env['HIVE_PTY_HOST_KINDS'] ?? 'fork,utilityProcess').split(',').map((kind) => {
  if (kind !== 'fork' && kind !== 'utilityProcess') {
    throw new Error(`HIVE_PTY_HOST_KINDS: "${kind}" is not a host; use fork, utilityProcess or both, comma-separated`);
  }
  return kind;
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function alive(pid: number | undefined | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type HostKind = 'fork' | 'utilityProcess';

/** Every host a factory made: the latest is the one running; all are killed after each case. */
interface Made {
  host: HostChild;
  /** The process this test started: the host itself (fork) or the Electron bridge (utilityProcess). */
  raw: ChildProcess;
}

function forkFactory(made: Made[], user?: HostUser): () => HostChild {
  return () => {
    let raw: ChildProcess | undefined;
    const host = forkPtyHost({
      entry: FORK_ENTRY,
      user,
      fork: ((file: string, args: readonly string[], options: object) => {
        raw = nodeFork(file, args, { ...options, execPath: process.env['HIVE_SERVER_NODE'] ?? process.execPath });
        return raw;
      }) as typeof nodeFork,
    });
    made.push({ host, raw: raw! });
    return host;
  };
}

type Frame =
  | { bridge: 'spawn'; pid: number }
  | { bridge: 'message'; message: HostMessage }
  | { bridge: 'exit'; code: number };

function utilityFactory(made: Made[]): () => HostChild {
  const electron = createRequire(import.meta.url)('electron') as string;
  return () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    const raw = spawn(electron, [BRIDGE, UTILITY_ENTRY], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env });

    let pid: number | undefined;
    let exited = false;
    const listeners = { message: [] as ((m: HostMessage) => void)[], exit: [] as ((c: number) => void)[], spawn: [] as (() => void)[] };
    const exit = (code: number): void => {
      if (exited) return;
      exited = true;
      for (const listener of listeners.exit) listener(code);
    };
    raw.on('message', (frame: Frame) => {
      if (frame.bridge === 'spawn') {
        pid = frame.pid;
        for (const listener of listeners.spawn) listener();
      } else if (frame.bridge === 'message') {
        for (const listener of listeners.message) listener(frame.message);
      } else {
        exit(frame.code);
      }
    });
    // The bridge going away without relaying the host's exit is the host gone too.
    raw.on('exit', () => exit(1));
    raw.on('error', (error) => console.error(`[utility-host-bridge] ${error.message}`));

    const host: HostChild = {
      get pid() {
        return pid;
      },
      postMessage(message) {
        if (raw.connected) raw.send({ bridge: 'post', message });
      },
      kill() {
        if (!raw.connected) return false;
        raw.send({ bridge: 'kill' });
        return true;
      },
      on: ((event: keyof typeof listeners, listener: never) => {
        (listeners[event] as unknown[]).push(listener);
      }) as HostChild['on'],
    };
    made.push({ host, raw });
    return host;
  };
}

interface Session {
  pid: number | null;
  output: string;
  exit: { exitCode: number; signal?: number } | null;
  errors: string[];
  lost: string | null;
}

/** One supervisor's sessions, as its events report them. */
function watch(supervisor: PtyHostSupervisor): Map<string, Session> {
  const sessions = new Map<string, Session>();
  const of = (id: string): Session => {
    let session = sessions.get(id);
    if (!session) {
      session = { pid: null, output: '', exit: null, errors: [], lost: null };
      sessions.set(id, session);
    }
    return session;
  };
  supervisor.onSpawned((m) => (of(m.sessionId).pid = m.pid));
  supervisor.onData((m) => (of(m.sessionId).output += m.chunk));
  supervisor.onExit((m) => (of(m.sessionId).exit = { exitCode: m.exitCode, ...(m.signal === undefined ? {} : { signal: m.signal }) }));
  supervisor.onError((m) => {
    if (m.sessionId) of(m.sessionId).errors.push(m.message);
  });
  supervisor.onSessionLost((m) => (of(m.sessionId).lost = m.reason));
  return sessions;
}

const temps: string[] = [];

function spawnSession(supervisor: PtyHostSupervisor, sessions: Map<string, Session>, id: string, cwd?: string): Session {
  const home = mkdtempSync(join(tmpdir(), 'hive-pty-host-'));
  temps.push(home);
  sessions.set(id, { pid: null, output: '', exit: null, errors: [], lost: null });
  supervisor.spawn({
    sessionId: id,
    shell: '/bin/sh',
    args: [],
    cwd: cwd ?? home,
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, TERM: 'xterm-256color' },
    cols: 80,
    rows: 24,
  });
  return sessions.get(id)!;
}

let running: { supervisor: PtyHostSupervisor; made: Made[] } | null = null;

function start(factory: (made: Made[]) => () => HostChild) {
  const made: Made[] = [];
  const supervisor = createPtyHostSupervisor({ fork: factory(made) });
  const sessions = watch(supervisor);
  running = { supervisor, made };
  return { supervisor, made, sessions, latest: () => made[made.length - 1]! };
}

afterEach(async () => {
  if (running) {
    if (running.supervisor.isRunning()) await running.supervisor.shutdown();
    for (const { host, raw } of running.made) {
      for (const pid of [host.pid, raw.pid]) if (alive(pid)) process.kill(pid!, 'SIGKILL');
    }
    running = null;
  }
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FACTORIES: Record<HostKind, (made: Made[]) => () => HostChild> = {
  fork: (made) => forkFactory(made),
  utilityProcess: (made) => utilityFactory(made),
};

describe.skipIf(!RUN).each(KINDS)('the PTY host under %s (HIVE-423)', (kind) => {
  const begin = () => start(FACTORIES[kind]);

  it('1: spawns, writes and reads, and reports the exit code', async () => {
    const { supervisor, sessions } = begin();
    const s = spawnSession(supervisor, sessions, 's1');
    await waitFor(() => s.pid !== null, 'spawned');
    supervisor.write('s1', 'echo OUT-$((40+2))\n');
    await waitFor(() => s.output.includes('OUT-42'), 'OUT-42');
    supervisor.write('s1', 'exit 7\n');
    await waitFor(() => s.exit !== null, 'the exit');
    expect(s.exit?.exitCode).toBe(7);
  }, CASE_MS);

  it('2: resizes', async () => {
    const { supervisor, sessions } = begin();
    const s = spawnSession(supervisor, sessions, 's1');
    await waitFor(() => s.pid !== null, 'spawned');
    supervisor.resize('s1', 100, 30);
    supervisor.write('s1', 'stty size\n');
    await waitFor(() => s.output.includes('30 100'), '30 100');
  }, CASE_MS);

  it('3: kills a session', async () => {
    const { supervisor, sessions } = begin();
    const s = spawnSession(supervisor, sessions, 's1');
    await waitFor(() => s.pid !== null, 'spawned');
    supervisor.kill('s1');
    await waitFor(() => s.exit !== null, 'the exit');
    expect(s.exit!.signal ?? s.exit!.exitCode).not.toBe(0);
  }, CASE_MS);

  it('4: pauses and resumes output', async () => {
    const { supervisor, sessions } = begin();
    const s = spawnSession(supervisor, sessions, 's1');
    await waitFor(() => s.pid !== null, 'spawned');
    // Let the prompt settle, so a late prompt chunk is not mistaken for the marker.
    await delay(300);
    supervisor.pause('s1');
    supervisor.write('s1', 'echo MARK-$((40+2))\n');
    await delay(500);
    expect(s.output).not.toContain('MARK-42');
    supervisor.resume('s1');
    await waitFor(() => s.output.includes('MARK-42'), 'MARK-42');
  }, CASE_MS);

  it('5: a host killed mid-stream loses its sessions, and the next spawn runs on a new host', async () => {
    const { supervisor, sessions, latest } = begin();
    const a = spawnSession(supervisor, sessions, 'a');
    const b = spawnSession(supervisor, sessions, 'b');
    await waitFor(() => a.pid !== null && b.pid !== null, 'both spawned');
    supervisor.write('a', 'while :; do echo x; done\n');
    await waitFor(() => a.output.length > 1000, 'a stream');
    const killed = latest().host.pid!;
    process.kill(killed, 'SIGKILL');
    await waitFor(() => a.lost === 'host-crashed' && b.lost === 'host-crashed', 'both lost');
    expect(supervisor.isRunning()).toBe(false);
    const c = spawnSession(supervisor, sessions, 'c');
    await waitFor(() => c.pid !== null, 'the third spawned');
    expect(latest().host.pid).not.toBe(killed);
  }, CASE_MS);

  it('6: the crash-loop guard refuses a spawn after CRASH_LIMIT crashes', async () => {
    const { supervisor, sessions, latest } = begin();
    for (let n = 0; n < CRASH_LIMIT; n += 1) {
      const s = spawnSession(supervisor, sessions, `crash-${n}`);
      await waitFor(() => s.pid !== null, `crash-${n} spawned`);
      process.kill(latest().host.pid!, 'SIGKILL');
      await waitFor(() => s.lost === 'host-crashed', `crash-${n} lost`);
    }
    expect(supervisor.isBlocked()).toBe(true);
    const refused = spawnSession(supervisor, sessions, 'refused');
    expect(refused.errors.join('\n')).toMatch(/crashed repeatedly/);
  }, 60_000);

  it('7: shutdown ends the host, the shell and a backgrounded descendant, inside the timeout', async () => {
    const { supervisor, sessions, latest } = begin();
    const s = spawnSession(supervisor, sessions, 's1');
    await waitFor(() => s.pid !== null, 'spawned');
    supervisor.write('s1', 'sleep 300 &\n');
    supervisor.write('s1', 'echo BG-$!\n');
    await waitFor(() => /BG-(\d+)/.test(s.output), 'the background pid');
    const background = Number(/BG-(\d+)/.exec(s.output)![1]);
    const hostPid = latest().host.pid!;
    const shell = s.pid!;
    expect(alive(background)).toBe(true);

    const began = Date.now();
    await supervisor.shutdown();
    expect(Date.now() - began).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    await waitFor(() => !alive(hostPid) && !alive(shell) && !alive(background), 'host, shell and background gone', 5_000);
  }, CASE_MS);
});

describe.skipIf(!RUN)('the fork host alone (HIVE-423)', () => {
  it('8: a closed channel stops the host and its sessions', async () => {
    const { supervisor, sessions, latest } = start((made) => forkFactory(made));
    const s = spawnSession(supervisor, sessions, 's1');
    await waitFor(() => s.pid !== null, 'spawned');
    const hostPid = latest().host.pid!;
    const shell = s.pid!;
    latest().raw.disconnect();
    await waitFor(() => !alive(hostPid) && !alive(shell), 'host and shell gone', 5_000);
  }, CASE_MS);

  // Needs root to switch users. The checkout must be readable by `nobody`; this first runs in HIVE-425's Linux CI.
  it.skipIf(process.getuid?.() !== 0)('9: a host forked as another user runs its sessions as that user', async () => {
    const uid = Number(execFileSync('id', ['-u', 'nobody'], { encoding: 'utf8' }).trim());
    const gid = Number(execFileSync('id', ['-g', 'nobody'], { encoding: 'utf8' }).trim());
    const { supervisor, sessions } = start((made) => forkFactory(made, { uid, gid }));
    const s = spawnSession(supervisor, sessions, 's1', '/tmp');
    await waitFor(() => s.pid !== null, 'spawned');
    supervisor.write('s1', 'id -u\n');
    await waitFor(() => new RegExp(`\\b${uid}\\b`).test(s.output), `uid ${uid}`);
  }, CASE_MS);
});

const dockerUp = RUN && spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!RUN || !dockerUp)('the /proc reader on Linux with no ps (HIVE-423)', () => {
  it('10: finds a real backgrounded descendant in a slim image', () => {
    const image = process.env['HIVE_LIVE_NODE_IMAGE'] ?? 'node:26-bookworm-slim';
    const script = `
      import { execFileSync, spawn } from 'node:child_process';
      import { processControl } from '/h/process-tree.ts';
      const shell = spawn('sh', ['-c', 'sleep 30 & sleep 30 & wait'], { detached: true, stdio: 'ignore' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const found = (await processControl.descendants([shell.pid])).length;
      let ps = true;
      try { execFileSync('ps', { stdio: 'ignore' }); } catch { ps = false; }
      console.log(JSON.stringify({ found, ps }));
      process.kill(-shell.pid, 'SIGKILL');
    `;
    const out = execFileSync(
      'docker',
      ['run', '--rm', '-v', `${join(ROOT, 'pty-host')}:/h:ro`, image, 'node', '--input-type=module', '-e', script],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(out.trim().split('\n').pop()!)).toEqual({ found: 2, ps: false });
  }, 120_000);
});
