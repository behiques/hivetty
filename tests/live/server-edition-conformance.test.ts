// @vitest-environment node
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isBuiltin } from 'node:module';
import { connect as netConnect, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LICENCE_LAPSED } from '../../core/agents/runs';
import { CH, type Channel } from '../../shared/ipc-contract';
import { REMOTE_PROTOCOL_VERSION, type ServerFrame } from '../../shared/remote-contract';
import { STUB_USER, startStubCloud, USER_CODE, type StubCloud } from '../e2e/electron/fixtures/stub-cloud';
import { claimsFor, makeSigner } from '../support/lease';
import { SecureTestSocket } from '../support/secure-test-socket';
import {
  SERVER_BIN,
  SERVER_ENTRY,
  SERVER_NODE,
  SERVER_OUT,
  serverCommand,
  writeKeyFile,
} from '../support/server-edition';

/**
 * The server edition, booted for real (HIVE-422): `node out/server/index.js`, built by `pnpm server:build` (which
 * `pnpm test:server-edition` runs first), spawned under `HIVE_SERVER_NODE` or this process's own Node, and attached
 * to over the encrypted channel from outside the process. `server/index.ts` and `server/boot.ts` are composition,
 * excluded from coverage; this suite is their proof.
 *
 * Case 1 plants a signed lease the server reads as lapsed, signed out: the edition gate then decides from the
 * lease on disk. Every home carries a secret key, since a server without one refuses to start (HIVE-424); cases 7
 * to 11 sign in against the stub cloud and prove the key's rules on a real process.
 *
 * `HIVE_SERVER_BIN` points every process at an unpacked tarball's `bin/hivetty-server` in place of `NODE ENTRY`,
 * and nothing is built. `HIVE_SERVER_RELEASE=1` says that server was built with `HIVETTY_RELEASE=1`, so the cases that
 * need a developer escape hatch (`HIVETTY_LEASE_KEYS`, `HIVETTY_CLOUD_URL`) are skipped.
 *
 * Gated behind `HIVE_LIVE_SERVER_EDITION_PROOF=1`. The `Server` workflow runs this suite against each Linux tarball
 * (HIVE-425).
 *
 * `HIVE_SERVER_IMAGE=<image ref>` runs only the image cases instead (HIVE-426): the base image booted with `docker run
 * --read-only --user 20001:20001`, its home a host folder mounted at `/var/lib/hivetty` and chowned to that uid by a
 * throwaway container, its key a file under `/run/secrets`. Case I1 needs Linux host networking to reach the loopback
 * bind; `HIVE_SERVER_RELEASE=1` skips it. The `Server` workflow runs them against the image it builds from each tarball,
 * and `release.yml` against the image it pushed.
 */
const RUN = process.env['HIVE_LIVE_SERVER_EDITION_PROOF'] === '1';
const NODE = SERVER_NODE;
const ROOT = join(import.meta.dirname, '../..');
const ENTRY = SERVER_ENTRY;
const RELEASE_ENTRY = join(ROOT, 'out/server-release/index.js');
const BIN = SERVER_BIN;
/** The server under test is a release build, which ignores every developer escape hatch. */
const RELEASE = process.env['HIVE_SERVER_RELEASE'] === '1';
/** The base image under test (HIVE-426); set, only the image cases run. */
const IMAGE = process.env['HIVE_SERVER_IMAGE'] || undefined;
/** Nothing listens here: the licence's cloud calls fail fast, and the lease's `iss` must equal it. */
const CLOUD = 'http://127.0.0.1:9';
const LOG_LINE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[[a-z-]+\] /;
const REFUSAL = "This edition isn't part of your plan";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no free port'));
        else resolve(address.port);
      });
    });
  });
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface Home {
  root: string;
  port: number;
  env: NodeJS.ProcessEnv;
}

const homes: string[] = [];
const children: ChildProcess[] = [];
const clouds: StubCloud[] = [];

/** The stub cloud on a `solo` plan, whose lease carries `runners.byo`, and the home pointed at it. */
async function useStubCloud(home: Home): Promise<StubCloud> {
  const cloud = await startStubCloud();
  clouds.push(cloud);
  cloud.controls.setPlan('solo');
  Object.assign(home.env, cloud.env);
  return cloud;
}

/**
 * A scratch HIVETTY_HOME with a loopback bind on a free port and one project, and its own HOME. `serverRoot` is the
 * path the home has where the server runs (a container's mount point), which is the path `config.json` names.
 */
async function makeHome(serverRoot?: string): Promise<Home> {
  const root = mkdtempSync(join(tmpdir(), 'hive-server-edition-'));
  homes.push(root);
  const port = await freePort();
  const project = join(serverRoot ?? root, 'project');
  mkdirSync(join(root, 'project'));
  mkdirSync(join(root, 'user'));
  writeFileSync(
    join(root, 'config.json'),
    JSON.stringify(
      {
        version: 2,
        importLoginEnv: false,
        projects: [{ id: 'scratch', key: 'sc', name: 'Scratch', path: project }],
        server: { bind: { host: '127.0.0.1', port, allowedOrigins: [] }, devices: [] },
      },
      null,
      2,
    ),
  );
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    LANG: 'en_US.UTF-8',
    HOME: join(root, 'user'),
    TMPDIR: process.env['TMPDIR'],
    HIVETTY_HOME: root,
    HIVETTY_CLOUD_URL: CLOUD,
    HIVETTY_SECRET_KEY: randomBytes(32).toString('hex'),
  };
  return { root, port, env };
}

/** A key file in its own folder, outside the home, named by HIVETTY_SECRET_KEY_FILE; the environment key goes. */
function useKeyFile(home: Home, key = randomBytes(32).toString('base64')): string {
  const { dir, file } = writeKeyFile(key);
  homes.push(dir);
  home.env['HIVETTY_SECRET_KEY_FILE'] = file;
  delete home.env['HIVETTY_SECRET_KEY'];
  return file;
}

/** `--login` against the stub cloud: answered mid-run, when the user code is printed. */
async function signIn(home: Home, cloud: StubCloud): Promise<void> {
  const child = spawn(...serverCommand(['--login']), { env: home.env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  await waitFor(() => out.includes(USER_CODE) || child.exitCode !== null, 'the device code on stdout');
  expect(out).toContain(USER_CODE);
  cloud.controls.approveDeviceCode();
  const code = await Promise.race([exited, delay(30_000).then(() => 'timeout' as const)]);
  expect(code, out).toBe(0);
}

/** A lease signed by a fresh key, planted where the server reads it; the env then trusts that key. */
function plantLease(home: Home, features: string[]): void {
  const signer = makeSigner('kid-server-edition');
  const now = Math.floor(Date.now() / 1000);
  mkdirSync(join(home.root, 'data'), { recursive: true });
  writeFileSync(
    join(home.root, 'data', 'lease.jws'),
    signer.sign(claimsFor({ iss: CLOUD, features, iat: now, exp: now + 7 * 86_400 })),
  );
  home.env['HIVETTY_LEASE_KEYS'] = JSON.stringify([signer.jwk]);
}

function runOnce(
  home: Home,
  args: string[],
  entry = ENTRY,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return promisify(execFile)(...serverCommand(args, entry), { env: home.env, timeout: 20_000 })
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((cause: { code?: number | null; stdout?: string; stderr?: string }) => ({
      code: typeof cause.code === 'number' ? cause.code : null,
      stdout: cause.stdout ?? '',
      stderr: cause.stderr ?? '',
    }));
}

async function pair(home: Home): Promise<{ id: string; token: string }> {
  const { code, stdout, stderr } = await runOnce(home, ['--pair', 'smoke']);
  expect(code, stderr).toBe(0);
  return parsePair(stdout);
}

/** `--pair`'s stdout: the token on the first line, then `Device id: …`. */
function parsePair(stdout: string): { id: string; token: string } {
  const token = stdout.split('\n')[0]?.trim() ?? '';
  const id = /Device id: (\S+)/.exec(stdout)?.[1] ?? '';
  expect(token).not.toBe('');
  expect(id).not.toBe('');
  return { id, token };
}

interface Served {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  exit: { code: number | null; signal: NodeJS.Signals | null } | null;
}

function serve(home: Home, entry = ENTRY): Served {
  const child = spawn(...serverCommand([], entry), { env: home.env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  let err = '';
  child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString()));
  const served: Served = {
    child,
    stdout: () => out,
    stderr: () => err,
    exit: null,
    exited: new Promise((resolve) =>
      child.on('exit', (code, signal) => {
        served.exit = { code, signal };
        resolve({ code, signal });
      }),
    ),
  };
  return served;
}

async function stopWithin(served: Served, ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  served.child.kill('SIGTERM');
  const timer = delay(ms).then(() => null);
  const result = await Promise.race([served.exited, timer]);
  if (result === null) throw new Error(`no exit within ${String(ms)} ms of SIGTERM`);
  return result;
}

interface Client {
  accepted: Record<string, unknown>;
  call(channel: Channel, payload: unknown): Promise<ServerFrame>;
  /** A fire-and-forget frame, as the renderer sends `pty:write`. */
  notify(channel: Channel, payload: unknown): void;
  /** Every `pty:data` chunk for the session so far, joined. */
  output(sessionId: string): string;
  close(): void;
}

function attach(port: number, device: { id: string; token: string }): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new SecureTestSocket(`ws://127.0.0.1:${String(port)}`);
    const pending = new Map<string, (frame: ServerFrame) => void>();
    const output = new Map<string, string>();
    let next = 0;
    const timer = setTimeout(() => reject(new Error('attach produced no answer in 15 s')), 15_000);
    socket.on('error', (cause: Error) => reject(cause));
    socket.on('close', (code: number) => reject(new Error(`closed before attaching (${String(code)})`)));
    socket.on('open', () =>
      socket.send(
        JSON.stringify({ kind: 'attach', protocol: REMOTE_PROTOCOL_VERSION, deviceId: device.id, token: device.token }),
      ),
    );
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(String(data)) as ServerFrame;
      if (frame.kind === 'attach-accepted') {
        clearTimeout(timer);
        resolve({
          accepted: frame as unknown as Record<string, unknown>,
          call: (channel, payload) =>
            new Promise((answer) => {
              next += 1;
              const id = `c${String(next)}`;
              pending.set(id, answer);
              socket.send(JSON.stringify({ kind: 'call', id, channel, payload }));
            }),
          notify: (channel, payload) => socket.send(JSON.stringify({ kind: 'notify', channel, payload })),
          output: (sessionId) => output.get(sessionId) ?? '',
          close: () => socket.terminate(),
        });
        return;
      }
      if (frame.kind === 'attach-refused') {
        clearTimeout(timer);
        reject(new Error(`attach refused: ${frame.code} ${frame.message}`));
        return;
      }
      if (frame.kind === 'result' || frame.kind === 'error') {
        pending.get(frame.id)?.(frame);
        pending.delete(frame.id);
      }
      // Ack every batch, as the renderer does: past 512 KiB unacked the server pauses the PTY.
      if (frame.kind === 'event' && frame.channel === CH.ptyData) {
        const event = frame.payload as { sessionId: string; seq: number; chunk: string };
        output.set(event.sessionId, (output.get(event.sessionId) ?? '') + event.chunk);
        socket.send(
          JSON.stringify({ kind: 'notify', channel: CH.ptyAck, payload: { sessionId: event.sessionId, seq: event.seq } }),
        );
      }
    });
  });
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe.skipIf(!RUN || IMAGE !== undefined)(`the server edition under ${BIN ?? NODE} (HIVE-422)`, () => {
  beforeAll(async () => {
    if (BIN !== undefined) return; // a tarball is already built; case 4 runs against it when it is a release one
    // Case 4's bundle: a release build, inside the repo so node_modules and resources/ resolve.
    await promisify(execFile)('pnpm', ['exec', 'vite', 'build', '--config', 'server.vite.config.ts', '--outDir', 'out/server-release'], {
      cwd: ROOT,
      env: { ...process.env, HIVETTY_RELEASE: '1' },
    });
  }, 120_000);

  afterEach(async () => {
    for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true });
    for (const cloud of clouds.splice(0)) await cloud.close();
  });

  it.skipIf(RELEASE)('1 and 6: serves a lease with runners.byo, attaches encrypted, refuses a spawn in words and keeps answering, stops on SIGTERM', async () => {
    const home = await makeHome();
    const device = await pair(home);
    plantLease(home, ['runners.byo']);
    const served = serve(home);
    await waitFor(() => served.exit !== null || accepts(home.port), `the listener on ${String(home.port)}`);
    expect(served.exit, served.stderr()).toBeNull();

    const client = await attach(home.port, device);
    try {
      expect(client.accepted['protocol']).toBe(REMOTE_PROTOCOL_VERSION);
      const history = await client.call(CH.sessionHistory, undefined);
      expect(history.kind, JSON.stringify(history)).toBe('result');
      expect((history as { payload: unknown }).payload).toEqual([]);


      // Case 6: the planted lease is lapsed, signed out, so the spawn is refused in the code's own words before the
      // PTY host is tried, and the failed call leaves the server answering.
      const spawned = await client.call(CH.ptySpawn, {
        sessionId: 'sess-edition',
        projectId: 'scratch',
        cols: 80,
        rows: 24,
      });
      expect(spawned.kind, JSON.stringify(spawned)).toBe('error');
      expect((spawned as { message: string }).message).toBe(LICENCE_LAPSED);
      // Case 12's plain shell takes the same gate, so its success there is the licence's doing.
      const shell = await client.call(CH.ptySpawnTerminal, { sessionId: 'sess-shell', projectId: 'scratch', cols: 80, rows: 24 });
      expect(shell.kind, JSON.stringify(shell)).toBe('error');
      expect((shell as { message: string }).message).toBe(LICENCE_LAPSED);
      const again = await client.call(CH.sessionHistory, undefined);
      expect(again.kind, JSON.stringify(again)).toBe('result');
      expect((again as { payload: unknown }).payload).toEqual([]);
    } finally {
      client.close();
    }

    const health = await runOnce(home, ['--health']);
    expect(health.code).toBe(0);

    const stopped = await stopWithin(served, 20_000);
    expect(stopped, served.stderr()).toEqual({ code: 0, signal: null });
    // Since HIVE-448 a fresh server prints nothing on stdout here: the only line it printed was the boot seed's own.
    // Whatever it does print keeps the format, which tests/server/log.test.ts pins.
    const lines = served.stdout().split('\n').filter((line) => line !== '');
    for (const line of lines) expect(line).toMatch(LOG_LINE);
  }, 90_000);

  it.skipIf(RELEASE)('2: refuses a lease without runners.byo, exits 3, and never listens', async () => {
    const home = await makeHome();
    plantLease(home, ['relay']);
    const served = serve(home);
    let listened = false;
    while (served.exit === null) {
      if (await accepts(home.port)) listened = true;
      await Promise.race([served.exited, delay(100)]);
    }
    expect(served.exit, served.stderr()).toEqual({ code: 3, signal: null });
    expect(served.stderr()).toContain(REFUSAL);
    expect(listened).toBe(false);
  }, 60_000);

  it('3: with no lease, stays up and healthy, listens nowhere, and stops on SIGTERM', async () => {
    const home = await makeHome();
    const served = serve(home);
    await waitFor(async () => (await runOnce(home, ['--health'])).code === 0, 'a healthy heartbeat');
    // Over a window, so a late bind is seen.
    for (let i = 0; i < 10; i += 1) {
      expect(await accepts(home.port)).toBe(false);
      await delay(300);
    }
    expect(served.exit, served.stderr()).toBeNull();
    expect(await stopWithin(served, 20_000)).toEqual({ code: 0, signal: null });
  }, 60_000);

  // Against a tarball, only a release one: a non-release tarball has no release bundle beside it.
  it.skipIf(BIN !== undefined && !RELEASE)('4: a release build ignores HIVETTY_LEASE_KEYS, HIVETTY_CLOUD_URL and HIVE_E2E', async () => {
    const home = await makeHome();
    await pair(home);
    plantLease(home, ['runners.byo']);
    home.env['HIVE_E2E'] = '1';
    const served = serve(home, RELEASE_ENTRY);
    await waitFor(async () => (await runOnce(home, ['--health'], RELEASE_ENTRY)).code === 0, 'a healthy heartbeat');
    for (let i = 0; i < 10; i += 1) {
      expect(await accepts(home.port)).toBe(false);
      await delay(300);
    }
    expect(served.exit, served.stderr()).toBeNull();
    expect(await stopWithin(served, 20_000)).toEqual({ code: 0, signal: null });
  }, 60_000);

  it.skipIf(RELEASE)(
    '12: a licensed server spawns a session through the fork host and its output comes back (HIVE-425)',
    async () => {
      const home = await makeHome();
      const cloud = await useStubCloud(home);
      useKeyFile(home);
      await signIn(home, cloud);
      const device = await pair(home);
      const served = serve(home);
      await waitFor(() => served.exit !== null || accepts(home.port), `the listener on ${String(home.port)}`);
      expect(served.exit, served.stderr()).toBeNull();

      const client = await attach(home.port, device);
      try {
        // A plain shell: the same lapse gate (case 6) and fork host as `pty:spawn`, without starting an agent CLI the runner
        // may lack (or this machine may start for real), so what is typed reaches a shell.
        const spawned = await client.call(CH.ptySpawnTerminal, {
          sessionId: 'sess-marker',
          projectId: 'scratch',
          cols: 200,
          rows: 24,
        });
        expect(spawned.kind, JSON.stringify(spawned)).toBe('result');
        // `%s`, so the marker exists only in the output: the PTY echoes the typed line, which holds no `MARK-12`.
        client.notify(CH.ptyWrite, { sessionId: 'sess-marker', data: "printf 'MARK-%s\\n' 12\r" });
        await waitFor(() => client.output('sess-marker').includes('MARK-12'), 'the marker in pty:data');
      } finally {
        client.close();
      }
      expect(await stopWithin(served, 20_000), served.stderr()).toEqual({ code: 0, signal: null });
    },
    120_000,
  );

  it('5: nothing under out/server imports electron', () => {
    expect(existsSync(join(SERVER_OUT, 'pty-host.js'))).toBe(true);
    const offenders = filesUnder(SERVER_OUT).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes('from "electron"') || text.includes("from 'electron'") || text.includes('require("electron")');
    });
    expect(offenders).toEqual([]);
  });

  it('5: every dependency but node-pty is bundled, and no public asset is copied in (HIVE-425)', () => {
    const files = filesUnder(SERVER_OUT);
    expect(files.filter((file) => file.endsWith('.png'))).toEqual([]);
    const bare = new Set<string>();
    // A specifier is a path or a package name, never prose: `from 'not your PR'` in a message string is not one.
    const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(["'])([\w@.:/-]+)\1/g;
    for (const file of files.filter((path) => path.endsWith('.js'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(specifier)) {
        const name = match[2] ?? '';
        if (name.startsWith('.') || name.startsWith('/') || isBuiltin(name)) continue;
        bare.add(name);
      }
    }
    expect([...bare].sort()).toEqual(['node-pty']);
  });

  it('7: with no key, serving and --login exit 4 naming both variables and never listen; --pair and --gen-key need none (HIVE-424)', async () => {
    const home = await makeHome();
    delete home.env['HIVETTY_SECRET_KEY'];
    let listened = false;
    const watching = (async () => {
      for (let i = 0; i < 20; i += 1) {
        if (await accepts(home.port)) listened = true;
        await delay(100);
      }
    })();
    for (const args of [[], ['--login']]) {
      const { code, stdout, stderr } = await runOnce(home, args);
      expect(code, stdout + stderr).toBe(4);
      expect(stdout + stderr).toContain('HIVETTY_SECRET_KEY_FILE');
      expect(stdout + stderr).toContain('HIVETTY_SECRET_KEY ');
    }
    await watching;
    expect(listened).toBe(false);
    expect((await runOnce(home, ['--pair', 'smoke'])).code).toBe(0);
    const generated = await runOnce(home, ['--gen-key']);
    expect(generated.code).toBe(0);
    expect(generated.stdout.trim()).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  }, 60_000);

  it('8: refuses a key file inside the home folder, beside the data (HIVE-424)', async () => {
    const home = await makeHome();
    const inside = join(home.root, 'key');
    writeFileSync(inside, randomBytes(32).toString('hex'), { mode: 0o600 });
    home.env['HIVETTY_SECRET_KEY_FILE'] = inside;
    const { code, stdout, stderr } = await runOnce(home, []);
    expect(code, stdout + stderr).toBe(4);
    expect(stdout + stderr).toContain('beside the data');
  }, 30_000);

  it.skipIf(RELEASE)('9 and 10: signs in with --login, seals account.bin, serves across a restart, and a wrong key reads as signed out, loudly (HIVE-424)', async () => {
    const home = await makeHome();
    const cloud = await useStubCloud(home);
    const keyFile = useKeyFile(home);
    await signIn(home, cloud);

    const sealed = readFileSync(join(home.root, 'data', 'account.bin'));
    expect(sealed[0]).toBe(0x01);
    expect(sealed.includes('rt-')).toBe(false);
    expect(sealed.includes(STUB_USER.email)).toBe(false);

    const device = await pair(home);
    for (const round of ['first boot', 'restart']) {
      const served = serve(home);
      await waitFor(() => served.exit !== null || accepts(home.port), `the listener on ${String(home.port)} (${round})`);
      expect(served.exit, served.stderr()).toBeNull();
      const client = await attach(home.port, device);
      client.close();
      expect(await stopWithin(served, 20_000), served.stderr()).toEqual({ code: 0, signal: null });
    }

    // Case 10: another key. The account reads as signed out with one warning line, and the server stays up.
    writeFileSync(keyFile, `${randomBytes(32).toString('base64')}\n`);
    const wrong = serve(home);
    await waitFor(() => wrong.exit !== null || wrong.stderr().includes('sealed with another key'), 'the wrong-key warning');
    expect(wrong.stderr()).toContain('sealed with another key');
    await delay(500);
    expect(wrong.exit, wrong.stderr()).toBeNull();
    await stopWithin(wrong, 20_000);
  }, 120_000);

  it.skipIf(RELEASE)('11: a child the server spawns never sees HIVETTY_SECRET_KEY (HIVE-424)', async () => {
    const home = await makeHome();
    const device = await pair(home);
    plantLease(home, ['runners.byo']);
    const bin = join(home.root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nenv > "$HIVE_ENV_DUMP"\nexit 1\n', { mode: 0o755 });
    const dump = join(home.root, 'gh-env.txt');
    home.env['HIVE_ENV_DUMP'] = dump;
    home.env['PATH'] = `${bin}:${home.env['PATH'] ?? ''}`;
    expect(home.env['HIVETTY_SECRET_KEY']).toMatch(/^[0-9a-f]{64}$/);

    const served = serve(home);
    await waitFor(() => served.exit !== null || accepts(home.port), `the listener on ${String(home.port)}`);
    expect(served.exit, served.stderr()).toBeNull();
    const client = await attach(home.port, device);
    try {
      const status = await client.call(CH.integrationsStatus, undefined);
      expect(status.kind, JSON.stringify(status)).toBe('result');
    } finally {
      client.close();
    }
    await waitFor(() => existsSync(dump), 'the fake gh to dump its environment', 10_000);
    const lines = readFileSync(dump, 'utf8').split('\n');
    expect(lines.some((line) => line.startsWith('HIVETTY_HOME='))).toBe(true);
    expect(lines.filter((line) => line.startsWith('HIVETTY_SECRET_KEY'))).toEqual([]);
    await stopWithin(served, 20_000);
  }, 60_000);
});

/** The uid the image cases run as: not the image's 10001, so nothing may assume it. */
const IMAGE_USER = '20001:20001';
const IMAGE_HOME = '/var/lib/hivetty';
const containers: string[] = [];

function docker(args: string[], timeout = 60_000): Promise<{ stdout: string; stderr: string }> {
  return promisify(execFile)('docker', args, { timeout });
}

/** `chown -R` the host folders to `owner`, from a throwaway root container, so uid 20001 (and back) owns them. */
async function chownAll(dirs: string[], owner: string): Promise<void> {
  if (IMAGE === undefined) return;
  const mounts = dirs.flatMap((dir, i) => ['-v', `${dir}:/h${String(i)}`]);
  const targets = dirs.map((_, i) => `/h${String(i)}`);
  await docker(['run', '--rm', '--user', '0', '--entrypoint', 'chown', ...mounts, IMAGE, '-R', owner, ...targets]);
}

/** A home and its key folder, laid out for the image and owned by uid 20001. */
async function imageHome(lease?: string[]): Promise<{ home: Home; keyDir: string; dirs: string[] }> {
  const home = await makeHome(IMAGE_HOME);
  const keyDir = dirname(useKeyFile(home));
  if (lease !== undefined) plantLease(home, lease);
  const dirs = [home.root, keyDir];
  await chownAll(dirs, IMAGE_USER);
  return { home, keyDir, dirs };
}

/** `docker run` as every image case runs it: read-only, uid 20001, the home and the key mounted. */
function runArgs(home: Home, keyDir: string, extra: string[], args: string[] = []): string[] {
  return [
    'run',
    '--read-only',
    '--user',
    IMAGE_USER,
    '-v',
    `${home.root}:${IMAGE_HOME}`,
    '-v',
    `${keyDir}:/run/secrets:ro`,
    '-e',
    'HIVETTY_SECRET_KEY_FILE=/run/secrets/key',
    ...extra,
    IMAGE ?? '',
    ...args,
  ];
}

/** A served container, detached, under a name no other case uses. */
async function serveImage(home: Home, keyDir: string, extra: string[]): Promise<string> {
  const name = `hive-server-edition-${randomBytes(4).toString('hex')}`;
  containers.push(name);
  await docker(runArgs(home, keyDir, ['-d', '--name', name, ...extra]));
  return name;
}

async function inspect(name: string, format: string): Promise<string> {
  return (await docker(['inspect', '-f', format, name])).stdout.trim();
}

/** Waits for `predicate`, failing early, with the container's logs, when it stops running. */
async function waitForContainer(name: string, predicate: () => Promise<boolean>, what: string): Promise<void> {
  await waitFor(async () => {
    if ((await inspect(name, '{{.State.Running}}')) !== 'true') {
      const logs = await docker(['logs', name]);
      throw new Error(`${name} exited before ${what}:\n${logs.stdout}${logs.stderr}`);
    }
    return predicate();
  }, what, 60_000);
}

describe.skipIf(!RUN || IMAGE === undefined)(`the image ${IMAGE ?? ''} (HIVE-426)`, () => {
  afterEach(async () => {
    for (const name of containers.splice(0)) await docker(['rm', '-f', name]).catch(() => undefined);
    // Back to this process's uid first, or the cleanup fails on what uid 20001 wrote. Docker Desktop's file sharing
    // refuses some of these chowns while the host already owns every file; a chown that truly failed shows up as the
    // rmSync's EACCES below, so its own error is not the one to report.
    const owner = `${String(process.getuid?.())}:${String(process.getgid?.())}`;
    const roots = homes.splice(0);
    if (roots.length > 0) await chownAll(roots, owner).catch(() => undefined);
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(RELEASE)('I1: pairs, serves a runners.byo lease and accepts an encrypted attach, then stops with 0', async () => {
    const { home, keyDir } = await imageHome(['runners.byo']);
    const dev = [
      '-e',
      `HIVETTY_CLOUD_URL=${home.env['HIVETTY_CLOUD_URL'] ?? ''}`,
      '-e',
      `HIVETTY_LEASE_KEYS=${home.env['HIVETTY_LEASE_KEYS'] ?? ''}`,
    ];
    const paired = await docker(runArgs(home, keyDir, ['--rm', ...dev], ['--pair', 'smoke']));
    const device = parsePair(paired.stdout);

    const name = await serveImage(home, keyDir, [...dev, '--network', 'host']);
    await waitForContainer(name, () => accepts(home.port), `the listener on ${String(home.port)}`);
    const client = await attach(home.port, device);
    try {
      expect(client.accepted['protocol']).toBe(REMOTE_PROTOCOL_VERSION);
    } finally {
      client.close();
    }

    await docker(['stop', '-t', '30', name], 45_000);
    expect(await inspect(name, '{{.State.ExitCode}}')).toBe('0');
  }, 120_000);

  it('I2: with no lease, the image reports healthy, creates TMPDIR, stops with 0 inside 30 s, and logs in lines', async () => {
    const { home, keyDir } = await imageHome();
    const name = await serveImage(home, keyDir, [
      '-e',
      `HIVETTY_CLOUD_URL=${CLOUD}`,
      '--health-interval=2s',
    ]);
    await waitForContainer(name, async () => (await inspect(name, '{{.State.Health.Status}}')) === 'healthy', 'healthy');
    // Asked from inside the container, as the server's own uid: on a Linux host the runner's uid cannot see into a
    // 0700 home owned by 20001, and existsSync answers false on that EACCES whether or not tmp/ is there.
    await expect(docker(['exec', name, 'test', '-d', `${IMAGE_HOME}/tmp`])).resolves.toBeDefined();

    const started = Date.now();
    await docker(['stop', '-t', '30', name], 45_000);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(await inspect(name, '{{.State.ExitCode}}')).toBe('0');
    const { stdout } = await docker(['logs', name]);
    for (const line of stdout.split('\n').filter((entry) => entry !== '')) expect(line).toMatch(LOG_LINE);
  }, 120_000);
});
