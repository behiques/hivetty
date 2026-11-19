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
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LICENCE_LAPSED } from '../../core/agents/runs';
import { CH, type Channel } from '../../shared/ipc-contract';
import { REMOTE_PROTOCOL_VERSION, type ServerFrame } from '../../shared/remote-contract';
import { STUB_USER, startStubCloud, USER_CODE, type StubCloud } from '../e2e/electron/fixtures/stub-cloud';
import { claimsFor, makeSigner } from '../support/lease';
import { SecureTestSocket } from '../support/secure-test-socket';

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
 */
const RUN = process.env['HIVE_LIVE_SERVER_EDITION_PROOF'] === '1';
const NODE = process.env['HIVE_SERVER_NODE'] ?? process.execPath;
const ROOT = join(import.meta.dirname, '../..');
const ENTRY = join(ROOT, 'out/server/index.js');
const RELEASE_ENTRY = join(ROOT, 'out/server-release/index.js');
/** An unpacked tarball's `bin/hivetty-server` (HIVE-425); its tree is the folder above `bin/`. */
const BIN = process.env['HIVE_SERVER_BIN'] || undefined;
const BIN_ROOT = BIN === undefined ? undefined : join(BIN, '../..');
/** The built server under test: the repo's `out/server`, or the tarball's `app/server`. */
const SERVER_OUT = BIN_ROOT === undefined ? join(ROOT, 'out/server') : join(BIN_ROOT, 'app/server');
/** The server under test is a release build, which ignores every developer escape hatch. */
const RELEASE = process.env['HIVE_SERVER_RELEASE'] === '1';
/** Nothing listens here: the licence's cloud calls fail fast, and the lease's `iss` must equal it. */
const CLOUD = 'http://127.0.0.1:9';
const LOG_LINE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[[a-z-]+\] /;
const REFUSAL = "This edition isn't part of your plan";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What to spawn for `args`: the tarball's wrapper when `HIVE_SERVER_BIN` is set, else `NODE entry`. */
function command(args: string[], entry = ENTRY): [file: string, argv: string[]] {
  return BIN === undefined ? [NODE, [entry, ...args]] : [BIN, args];
}

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

/** A scratch HIVETTY_HOME with a loopback bind on a free port and one project, and its own HOME. */
async function makeHome(): Promise<Home> {
  const root = mkdtempSync(join(tmpdir(), 'hive-server-edition-'));
  homes.push(root);
  const port = await freePort();
  const project = join(root, 'project');
  mkdirSync(project);
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
  const dir = mkdtempSync(join(tmpdir(), 'hive-server-key-'));
  homes.push(dir);
  const file = join(dir, 'key');
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  home.env['HIVETTY_SECRET_KEY_FILE'] = file;
  delete home.env['HIVETTY_SECRET_KEY'];
  return file;
}

/** `--login` against the stub cloud: answered mid-run, when the user code is printed. */
async function signIn(home: Home, cloud: StubCloud): Promise<void> {
  const child = spawn(...command(['--login']), { env: home.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  return promisify(execFile)(...command(args, entry), { env: home.env, timeout: 20_000 })
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
  const child = spawn(...command([], entry), { env: home.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  close(): void;
}

function attach(port: number, device: { id: string; token: string }): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new SecureTestSocket(`ws://127.0.0.1:${String(port)}`);
    const pending = new Map<string, (frame: ServerFrame) => void>();
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
    });
  });
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe.skipIf(!RUN)(`the server edition under ${BIN ?? NODE} (HIVE-422)`, () => {
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
    const lines = served.stdout().split('\n').filter((line) => line !== '');
    expect(lines.length).toBeGreaterThan(0);
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

  /*
    A spawn through the server needs a licensed server; a lapsed one refuses the spawn before the PTY host is tried
    (case 6 above). Sign-in (case 9) makes a licensed one possible. `pnpm test:pty-host` drives the fork host itself.
  */
  it.todo('a licensed server spawns a session through the fork host');

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
