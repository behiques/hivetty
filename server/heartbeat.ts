import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** HIVE-422: the file under the data folder a container's health probe reads through `--health`. */
export const HEARTBEAT_FILE = 'heartbeat';
export const HEARTBEAT_EVERY_MS = 15_000;
/** Three missed beats. */
export const HEARTBEAT_STALE_MS = 45_000;

export interface HeartbeatIo {
  write(file: string, text: string): void;
  rename(from: string, to: string): void;
  now(): number;
  pid: number;
}

export interface HealthIo {
  read(file: string): string;
  now(): number;
  alive(pid: number): boolean;
}

const realHeartbeatIo = (): HeartbeatIo => ({
  write: (file, text) => writeFileSync(file, text),
  rename: (from, to) => renameSync(from, to),
  now: Date.now,
  pid: process.pid,
});

/** `kill(pid, 0)` delivers nothing; it only asks. EPERM means the process exists under another user. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Write `<ISO time> <pid>` now and every 15 s, through a temp file and a rename so a reader never sees half a file.
 * A failed write is logged and the next tick tries again. The timer never holds the process open. Returns the stop.
 */
export function startHeartbeat(file: string, io: HeartbeatIo = realHeartbeatIo()): () => void {
  const temp = `${file}.tmp`;
  const beat = (): void => {
    try {
      io.write(temp, `${new Date(io.now()).toISOString()} ${String(io.pid)}\n`);
      io.rename(temp, file);
    } catch (cause) {
      console.error(`[heartbeat] could not write ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** `--health`: 0 when the heartbeat is under 45 s old and its pid is alive, else 1. */
export function checkHealth(file: string, io: Partial<HealthIo> = {}): 0 | 1 {
  const read = io.read ?? ((path: string) => readFileSync(path, 'utf8'));
  const now = io.now ?? Date.now;
  const alive = io.alive ?? pidAlive;
  let text: string;
  try {
    text = read(file);
  } catch {
    return 1;
  }
  const match = /^(\S+) (\d+)\n?$/.exec(text);
  if (!match) return 1;
  const at = Date.parse(match[1] as string);
  if (Number.isNaN(at) || now() - at >= HEARTBEAT_STALE_MS) return 1;
  return alive(Number(match[2])) ? 0 : 1;
}
