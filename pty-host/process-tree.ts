import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

/**
 * Reading and signalling the process tree (HIVE-72).
 *
 * The only module that reads the process table.
 *
 * It exists because `kill(-shellPid)` reaches exactly one process *group*, and
 * the session shell is `/bin/sh -l` on a real pty — interactive, so job
 * control is on, so `&` puts the backgrounded job in a group of its own. The
 * group kill structurally cannot reach the thing this app most needs dead: a
 * `claude` that outlives the window is invisible, keeps consuming tokens, and
 * can still write to the repository.
 */

/** A live descendant of a session shell, with the group it belongs to. */
export interface Descendant {
  pid: number;
  pgid: number;
}

export interface ProcessControl {
  /** Signal a process group. */
  signalGroup(pgid: number, signal: NodeJS.Signals): void;
  /** Signal a single process. */
  signalPid(pid: number, signal: NodeJS.Signals): void;
  /** Whether a pid is still around. */
  isAlive(pid: number): boolean;
  /** Every descendant of every root. Resolves empty when unreadable. */
  descendants(roots: readonly number[]): Promise<Descendant[]>;
}

/**
 * How long `ps` gets before teardown gives up on knowing the tree.
 *
 * Deliberately short. This runs on the app's quit path, inside a budget the
 * supervisor enforces with a force-kill, and a `ps` still running after half a
 * second is not going to produce an answer that arrives in time to be useful.
 * Giving up early leaves budget for the signals, which are the part that
 * actually kills anything.
 */
const PS_TIMEOUT_MS = 500;

/**
 * The lowest pid or pgid worth signalling.
 *
 * `process.kill(-0, sig)` is `kill(0, sig)` — *every process in the caller's
 * own group*, i.e. the pty-host shooting itself. `kill(-1, sig)` is every
 * process the user can signal. Neither can come from a well-formed `ps` on a
 * real session, but the cost of being wrong is the user's whole login, so the
 * table is filtered rather than trusted. pid 1 is init/launchd; nothing below
 * that is ever a session descendant.
 */
const LOWEST_SIGNALLABLE = 2;

/** Room for a very busy machine — a truncated table reads as a short one. */
const PS_MAX_BUFFER = 4 * 1024 * 1024;

interface Row {
  pid: number;
  ppid: number;
  pgid: number;
}

/** Parse `ps -eo pid=,ppid=,pgid=` — three padded numeric columns, no header. */
export function parseProcessTable(text: string): Row[] {
  const rows: Row[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length !== 3) continue;

    const [pid, ppid, pgid] = parts.map(Number);
    if (
      !Number.isInteger(pid) ||
      !Number.isInteger(ppid) ||
      !Number.isInteger(pgid)
    ) {
      continue;
    }

    /**
     * `ppid` is left alone — 0 and 1 are ordinary there, and a row whose parent
     * is init is exactly how the tree terminates. `pid` and `pgid` are what get
     * signalled, and a 0 among them would signal the caller's own group.
     * Linux reports pgid 0 for kernel threads, so this is not hypothetical.
     */
    if (pid < LOWEST_SIGNALLABLE || pgid < LOWEST_SIGNALLABLE) continue;

    rows.push({ pid, ppid, pgid });
  }

  return rows;
}

/** Every descendant of `roots`, breadth-first, roots excluded. */
export function walkDescendants(
  rows: readonly Row[],
  roots: readonly number[],
): Descendant[] {
  const children = new Map<number, Row[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid);
    if (siblings) siblings.push(row);
    else children.set(row.ppid, [row]);
  }

  /**
   * Seeded with the roots, which does two jobs: a root that is itself a
   * descendant of another root is not reported, and a `ppid` cycle cannot loop
   * here forever. No sane kernel produces a cycle — but a parser that *can*
   * hang has no business on the app's quit path.
   */
  const seen = new Set<number>(roots);
  const queue = [...roots];
  const found: Descendant[] = [];

  while (queue.length > 0) {
    const pid = queue.shift()!;

    for (const child of children.get(pid) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      found.push({ pid: child.pid, pgid: child.pgid });
      queue.push(child.pid);
    }
  }

  return found;
}

/** How many `/proc/<pid>/stat` files are open at once: well under any fd ulimit, so EMFILE stays rare. */
const PROC_READ_BATCH = 64;

/** The process ended between the listing and the read. Anything else means the table cannot be trusted whole. */
const ENDED = new Set(['ENOENT', 'ESRCH']);

/**
 * Linux (HIVE-423): the three columns `ps` prints, read from `/proc/<pid>/stat`, so a slim image with no
 * `procps` still finds a session's descendants. Any failure to list answers `''`, as the `ps` reader does,
 * and so does any failed read other than an ended process: a partial table would hide descendants without
 * the caller's warning.
 */
export async function readProcTable(procDir = '/proc'): Promise<string> {
  let names: string[];
  try {
    names = await readdir(procDir); // throws: the caller sees '' and warns once
  } catch {
    return '';
  }
  const pids = names.filter((name) => /^\d+$/.test(name));
  const readOne = async (pid: string): Promise<string> => {
    let stat: string;
    try {
      stat = await readFile(`${procDir}/${pid}/stat`, 'utf8');
    } catch (error) {
      if (ENDED.has((error as NodeJS.ErrnoException).code ?? '')) return '';
      throw error;
    }
    // `comm` may hold spaces, parentheses and newlines: the fields start after the LAST ")".
    const close = stat.lastIndexOf(')');
    if (close === -1) return '';
    const [, ppid, pgrp] = stat.slice(close + 1).trim().split(/\s+/);
    return `${pid} ${ppid} ${pgrp}`; // a short line prints "undefined", which the parser drops
  };
  const lines: string[] = [];
  try {
    for (let start = 0; start < pids.length; start += PROC_READ_BATCH) {
      lines.push(...(await Promise.all(pids.slice(start, start + PROC_READ_BATCH).map(readOne))));
    }
  } catch {
    return ''; // EMFILE, EACCES, …: the caller sees '' and warns once
  }
  return lines.filter((line) => line !== '').join('\n');
}

/** Read the table, answering `''` for any failure at all. */
function readProcessTable(platform: NodeJS.Platform, procDir?: string): Promise<string> {
  if (platform === 'linux') return readProcTable(procDir);
  return new Promise((resolve) => {
    execFile(
      // Pinned rather than resolved through PATH: this runs with the app's
      // inherited environment, and the result is fed straight into `kill`.
      '/bin/ps',
      ['-eo', 'pid=,ppid=,pgid='],
      { timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER },
      (error, stdout) => {
        resolve(error ? '' : stdout);
      },
    );
  });
}

interface ProcessControlDeps {
  /** Injected so tests never exec a real `ps`. */
  readTable?: () => Promise<string>;
  platform?: NodeJS.Platform;
  /** Linux only: where the process table is mounted. A parameter so a test names a fixture tree. */
  procDir?: string;
}

export function createProcessControl({
  readTable,
  platform = process.platform,
  procDir,
}: ProcessControlDeps = {}): ProcessControl {
  const read = readTable ?? (() => readProcessTable(platform, procDir));
  let warned = false;
  return {
    signalGroup(pgid, signal) {
      // Belt and braces: the parser already drops these, and this is the call
      // where getting it wrong SIGKILLs the pty-host's own process group.
      if (!Number.isInteger(pgid) || pgid < LOWEST_SIGNALLABLE) return;

      // Negative pid means "the process group led by pgid".
      process.kill(-pgid, signal);
    },

    signalPid(pid, signal) {
      if (!Number.isInteger(pid) || pid < LOWEST_SIGNALLABLE) return;

      process.kill(pid, signal);
    },

    isAlive(pid) {
      try {
        // Signal 0 asks the question without delivering anything.
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },

    async descendants(roots) {
      if (roots.length === 0) return [];

      // No Windows build is packaged (`core/config/probe.ts`); this is
      // about not shelling out to a `ps` that does not exist.
      if (platform === 'win32') return [];

      const table = await read();
      if (table === '') {
        if (!warned) {
          warned = true;
          console.warn(
            `[pty-host] the process table could not be read; descendants of ${roots.length} session(s) will not be cleaned up`,
          );
        }
        return [];
      }

      return walkDescendants(parseProcessTable(table), roots);
    },
  };
}

/** The real one. Injected over in every test. */
export const processControl: ProcessControl = createProcessControl();
