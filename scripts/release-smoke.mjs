/**
 * `pnpm release:smoke`: package the app outside the checkout, launch it once,
 * prove it stays up, then kill it and delete everything (HIVE-417 item 10).
 *
 * 1.0.0 crashed 85 ms after launch on every install (`docs/packaging-and-updates.md`,
 * "The app's name"), and the updater cannot recover a build that never starts.
 * The old recipe (`timeout 5 …`) wrote into `dist/` inside the checkout, needed
 * a `timeout` macOS does not ship, and against an installed HiveTTY Pro it
 * passed for the wrong reason: the single-instance lock made the smoke build
 * quit with exit 0.
 *
 * So this script:
 * - packages with `electron-builder --dir --publish never` into a fresh
 *   `os.tmpdir()` folder, unsigned and unnotarised (`package.json` runs
 *   `desktop:build` first, whose `out/` is the build's ordinary output);
 * - launches the binary with its own `--user-data-dir` and `HIVE_CONFIG_PATH`,
 *   so it shares no lock and no hive folder with the installed app;
 * - waits, then checks the pid it spawned is alive;
 * - kills only that pid's process group, and removes the temp folder in a
 *   `finally`, pass or fail.
 *
 * It never signs, notarises or publishes, and touches no other process.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** How long the app must stay up to pass. 1.0.0 died in 85 ms. */
export const SMOKE_WINDOW_MS = 6_000;
/** Grace between SIGTERM and SIGKILL. */
export const KILL_GRACE_MS = 3_000;

/** electron-builder's argv: a directory build into `outputDir`, unsigned, never published. */
export function builderArgs(outputDir) {
  return [
    '--mac',
    '--arm64',
    '--dir',
    '--publish',
    'never',
    `-c.directories.output=${outputDir}`,
    '-c.mac.identity=null',
    '-c.mac.notarize=false',
  ];
}

/**
 * The executable inside the one `.app` electron-builder wrote under
 * `<outputDir>/mac-arm64/`, or null. `list` is injected so this stays pure.
 */
export function findAppBinary(outputDir, list) {
  const macDir = join(outputDir, 'mac-arm64');
  const app = list(macDir).find((name) => name.endsWith('.app'));
  if (!app) return null;
  return join(macDir, app, 'Contents', 'MacOS', app.slice(0, -'.app'.length));
}

/** Command, argv and env for the launch: profile and hive folder both inside `tmp`. */
export function launchPlan(binary, tmp, baseEnv) {
  const profile = join(tmp, 'profile');
  return {
    command: binary,
    args: [`--user-data-dir=${profile}`],
    env: { ...baseEnv, HIVE_CONFIG_PATH: join(profile, 'config.json') },
  };
}

/** Is `path` the checkout or inside it? The smoke must write nothing there. */
export function isInside(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The last `n` non-empty lines of `text`. */
export function tailLines(text, n) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-n)
    .join('\n');
}

/** One message for an app that died inside the smoke window. */
export function describeExit({ code, signal, stderr }, lines = 20) {
  const how = code === null ? `signal ${signal}` : `code ${code}`;
  const tail = tailLines(stderr, lines);
  return `The app exited before the smoke window ended (${how}).\n${tail === '' ? '(no stderr)' : tail}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** SIGTERM the group, SIGKILL it after the grace. Throws if the pid survives. */
async function killGroup(pid) {
  const signalGroup = (signal) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is already gone.
    }
  };
  signalGroup('SIGTERM');
  const deadline = Date.now() + KILL_GRACE_MS;
  while (alive(pid) && Date.now() < deadline) await sleep(100);
  if (alive(pid)) {
    signalGroup('SIGKILL');
    await sleep(500);
  }
  if (alive(pid)) throw new Error(`could not kill the smoke app (pid ${pid}); kill it by hand`);
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('release:smoke packages for macOS arm64 and runs only there');
  }
  const tmp = mkdtempSync(join(tmpdir(), 'hivetty-release-smoke-'));
  if (isInside(tmp, appRoot)) throw new Error(`temp folder ${tmp} is inside the checkout`);

  let pid = null;
  let failure = null;
  try {
    const outputDir = join(tmp, 'dist');
    console.log(`release:smoke: packaging into ${outputDir}`);
    const build = spawnSync('pnpm', ['exec', 'electron-builder', ...builderArgs(outputDir)], {
      cwd: appRoot,
      stdio: 'inherit',
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    });
    if (build.status !== 0) throw new Error(`electron-builder failed (exit ${build.status ?? build.signal})`);

    const binary = findAppBinary(outputDir, (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    });
    if (!binary) throw new Error(`no .app under ${join(outputDir, 'mac-arm64')}`);

    const plan = launchPlan(binary, tmp, process.env);
    console.log(`release:smoke: launching ${binary}`);
    const child = spawn(plan.command, plan.args, {
      env: plan.env,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    pid = child.pid;
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-64_000);
    });
    let exit = null;
    child.on('exit', (code, signal) => {
      exit = { code, signal };
    });
    child.on('error', (error) => {
      exit = { code: null, signal: error.message };
    });

    await sleep(SMOKE_WINDOW_MS);
    if (exit !== null || pid === undefined || !alive(pid)) {
      throw new Error(describeExit({ ...(exit ?? { code: null, signal: 'unknown' }), stderr }));
    }
    console.log(`release:smoke: pid ${pid} still up after ${SMOKE_WINDOW_MS / 1000} s`);
    child.stderr.destroy();
  } catch (error) {
    failure = error;
  } finally {
    if (pid) {
      try {
        await killGroup(pid);
      } catch (error) {
        failure ??= error;
      }
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failure) throw failure;
  console.log('release:smoke: passed; the app was killed and the temp folder removed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`release:smoke: FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
