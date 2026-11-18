// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkHealth,
  HEARTBEAT_EVERY_MS,
  HEARTBEAT_FILE,
  HEARTBEAT_STALE_MS,
  startHeartbeat,
} from '../../server/heartbeat';

const T0 = Date.parse('2026-11-18T00:00:00.000Z');

describe('startHeartbeat (HIVE-422)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const io = () => ({
    write: vi.fn<(file: string, text: string) => void>(),
    rename: vi.fn<(from: string, to: string) => void>(),
    now: () => Date.now(),
    pid: 42,
  });

  it('names its file and its cadence', () => {
    expect(HEARTBEAT_FILE).toBe('heartbeat');
    expect(HEARTBEAT_EVERY_MS).toBe(15_000);
    expect(HEARTBEAT_STALE_MS).toBe(45_000);
  });

  it('writes at once through a temp file and a rename', () => {
    const fake = io();
    const stop = startHeartbeat('/d/heartbeat', fake);
    expect(fake.write).toHaveBeenCalledWith('/d/heartbeat.tmp', '2026-11-18T00:00:00.000Z 42\n');
    expect(fake.rename).toHaveBeenCalledWith('/d/heartbeat.tmp', '/d/heartbeat');
    stop();
  });

  it('writes again every 15 s until stopped', () => {
    const fake = io();
    const stop = startHeartbeat('/d/heartbeat', fake);
    vi.advanceTimersByTime(14_999);
    expect(fake.write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fake.write).toHaveBeenCalledTimes(2);
    expect(fake.write).toHaveBeenLastCalledWith('/d/heartbeat.tmp', '2026-11-18T00:00:15.000Z 42\n');
    stop();
    vi.advanceTimersByTime(60_000);
    expect(fake.write).toHaveBeenCalledTimes(2);
  });

  it('survives a failed write, logs it, and writes on the next tick', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = io();
    fake.write.mockImplementationOnce(() => {
      throw new Error('EROFS');
    });
    const stop = startHeartbeat('/d/heartbeat', fake);
    expect(fake.rename).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('EROFS');
    vi.advanceTimersByTime(15_000);
    expect(fake.rename).toHaveBeenCalledTimes(1);
    stop();
  });

  it('never holds the process open', () => {
    const unref = vi.fn();
    const handle = { unref };
    const spy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation((() => handle) as unknown as typeof setInterval);
    const clear = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    const stop = startHeartbeat('/d/heartbeat', io());
    expect(unref).toHaveBeenCalled();
    stop();
    expect(clear).toHaveBeenCalledWith(handle);
    clear.mockRestore();
    spy.mockRestore();
  });
});

describe('startHeartbeat on disk (HIVE-422)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-heartbeat-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a file checkHealth reads as healthy, with the real defaults', () => {
    const file = join(dir, HEARTBEAT_FILE);
    const stop = startHeartbeat(file);
    stop();
    expect(readFileSync(file, 'utf8')).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z ${process.pid}\\n$`));
    expect(checkHealth(file)).toBe(0);
  });

  it('reads a missing or garbage file as unhealthy, with the real defaults', () => {
    const file = join(dir, HEARTBEAT_FILE);
    expect(checkHealth(file)).toBe(1);
    writeFileSync(file, 'nonsense');
    expect(checkHealth(file)).toBe(1);
  });
});

describe('checkHealth (HIVE-422)', () => {
  const at = (ageMs: number, pid = 42) => `${new Date(T0 - ageMs).toISOString()} ${pid}\n`;
  const io = (text: string | null, alive = true) => ({
    read: () => {
      if (text === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return text;
    },
    now: () => T0,
    alive: () => alive,
  });

  it('is 0 for a fresh heartbeat from a live pid', () => {
    expect(checkHealth('/d/heartbeat', io(at(0)))).toBe(0);
  });

  it('is 0 at 44 s and 1 at 45 s', () => {
    expect(checkHealth('/d/heartbeat', io(at(44_000)))).toBe(0);
    expect(checkHealth('/d/heartbeat', io(at(45_000)))).toBe(1);
  });

  it('is 1 for a dead pid', () => {
    expect(checkHealth('/d/heartbeat', io(at(0), false))).toBe(1);
  });

  it('is 1 for a missing file', () => {
    expect(checkHealth('/d/heartbeat', io(null))).toBe(1);
  });

  it('is 1 for garbage', () => {
    expect(checkHealth('/d/heartbeat', io('garbage'))).toBe(1);
    expect(checkHealth('/d/heartbeat', io('not-a-date 42\n'))).toBe(1);
    expect(checkHealth('/d/heartbeat', io(`${new Date(T0).toISOString()} x\n`))).toBe(1);
  });

  it('counts EPERM from the default liveness probe as alive', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });
    expect(checkHealth('/d/heartbeat', { read: () => at(0, 1), now: () => T0 })).toBe(0);
    kill.mockImplementation(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });
    expect(checkHealth('/d/heartbeat', { read: () => at(0, 1), now: () => T0 })).toBe(1);
  });
});
