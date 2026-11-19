import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claimServerLock,
  hasActiveServerLock,
  hiveLockPath,
  processIdentity,
  type ProcessIdentitySystem,
  type ServerLockIo,
} from '../../../core/server/server-lock';

const LOCK_PATH = '/tmp/the-hive-server.lock';

function harness(
  contents: string | undefined,
  livePids: readonly number[] = [],
  recoveryGuardHeld = false,
  recoveryIdentity = '42:current',
) {
  let stored = contents;
  let recoveryStored = recoveryGuardHeld
    ? `{"pid":42,"identity":"${recoveryIdentity}"}`
    : undefined;
  const writes: string[] = [];
  const removed: string[] = [];
  const io: ServerLockIo & {
    createRecoveryGuard: (path: string, contents?: string) => void;
    removeRecoveryGuard: (path: string) => void;
    processIdentity: (pid: number) => string | null;
  } = {
    create: (_path, next) => {
      if (stored !== undefined) {
        const cause = new Error('already exists') as NodeJS.ErrnoException;
        cause.code = 'EEXIST';
        throw cause;
      }
      stored = next;
      writes.push(next);
    },
    read: (path) => {
      const target = path.endsWith('.recovery') ? recoveryStored : stored;
      if (target === undefined) {
        const cause = new Error('not found') as NodeJS.ErrnoException;
        cause.code = 'ENOENT';
        throw cause;
      }
      return target;
    },
    remove: (path) => {
      if (path.endsWith('.recovery')) recoveryStored = undefined;
      else {
        stored = undefined;
        removed.push(LOCK_PATH);
      }
    },
    createRecoveryGuard: (_path, next = '') => {
      if (recoveryStored !== undefined) {
        const cause = new Error('already exists') as NodeJS.ErrnoException;
        cause.code = 'EEXIST';
        throw cause;
      }
      recoveryStored = next;
    },
    removeRecoveryGuard: () => {
      recoveryStored = undefined;
    },
    processIdentity: (pid) =>
      pid === 99 || livePids.includes(pid) ? `${String(pid)}:current` : null,
  };
  return { io, writes, removed, contents: () => stored };
}

describe('server lock', () => {
  it('reports a lock owned by a live server as active', () => {
    const { io } = harness('{"pid":42,"identity":"42:current"}', [42]);

    expect(hasActiveServerLock(LOCK_PATH, io)).toBe(true);
  });

  it('replaces a stale lock before claiming server ownership', () => {
    const { io, writes, removed, contents } = harness('{"pid":42,"identity":"42:old"}');

    const claim = claimServerLock(LOCK_PATH, 99, io);

    expect(claim.kind).toBe('claimed');
    expect(removed).toEqual([LOCK_PATH]);
    expect(writes).toEqual(['{"pid":99,"identity":"99:current"}']);
    expect(contents()).toBe('{"pid":99,"identity":"99:current"}');
  });

  it('does not replace a stale lock while another claimant is recovering it', () => {
    const { io, contents, removed } = harness('{"pid":42,"identity":"42:old"}', [42], true);

    expect(claimServerLock(LOCK_PATH, 99, io)).toEqual({ kind: 'active', pid: 42 });
    expect(contents()).toBe('{"pid":42,"identity":"42:old"}');
    expect(removed).toEqual([]);
  });

  it('names the live holder of the lock', () => {
    const { io } = harness('{"pid":42,"identity":"42:current"}', [42]);
    expect(claimServerLock(LOCK_PATH, 99, io)).toEqual({ kind: 'active', pid: 42 });
  });

  it('says it cannot name the holder of a garbled lock', () => {
    const { io } = harness('not-json');
    expect(claimServerLock(LOCK_PATH, 99, io)).toEqual({ kind: 'active', pid: null });
  });

  it('fails closed for a malformed lock', () => {
    const { io } = harness('not-json');

    expect(hasActiveServerLock(LOCK_PATH, io)).toBe(true);
  });

  it('reclaims a recovery guard whose owner PID was reused', () => {
    const { io, contents } = harness('{"pid":42,"identity":"42:old"}', [42], true, '42:old');

    expect(claimServerLock(LOCK_PATH, 99, io).kind).toBe('claimed');
    expect(contents()).toBe('{"pid":99,"identity":"99:current"}');
  });

  it('does not mistake a reused PID for the lock owner', () => {
    const { io } = harness('{"pid":42,"identity":"42:old"}', [42]);

    expect(hasActiveServerLock(LOCK_PATH, io)).toBe(false);
  });

  it('releases only the lock it claimed', () => {
    const { io, removed } = harness(undefined);
    const claim = claimServerLock(LOCK_PATH, 99, io);

    expect(claim.kind).toBe('claimed');
    if (claim.kind === 'claimed') claim.release();

    expect(removed).toEqual([LOCK_PATH]);
  });
});

describe('the hive lock on a real folder (HIVE-227)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-lock-'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sits beside the config file', () => {
    vi.stubEnv('HIVE_CONFIG_PATH', join(dir, 'config.json'));
    expect(hiveLockPath()).toBe(join(dir, 'hive.lock'));
  });

  it('refuses a second claim on one folder, naming the first, until it is released', () => {
    const path = join(dir, 'hive.lock');
    const first = claimServerLock(path);
    expect(first.kind).toBe('claimed');

    expect(claimServerLock(path)).toEqual({ kind: 'active', pid: process.pid });

    if (first.kind === 'claimed') first.release();
    expect(existsSync(path)).toBe(false);
    const again = claimServerLock(path);
    expect(again.kind).toBe('claimed');
    if (again.kind === 'claimed') again.release();
  });

  it('takes over a lock left by a process that has exited', () => {
    const path = join(dir, 'hive.lock');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(path, JSON.stringify({ pid: gone, identity: `${String(gone)}:gone` }));

    const claim = claimServerLock(path);
    expect(claim.kind).toBe('claimed');
    if (claim.kind === 'claimed') claim.release();
  });
});

describe('processIdentity (HIVE-426)', () => {
  function system(overrides: Partial<ProcessIdentitySystem>): ProcessIdentitySystem {
    return {
      platform: 'linux',
      alive: () => true,
      readStat: () => {
        throw new Error('readStat not expected');
      },
      psStart: () => {
        throw new Error('ps not expected');
      },
      ...overrides,
    };
  }

  function enoent(): Error {
    return Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  }

  it('on Linux, reads the start time from /proc/<pid>/stat, field 22, after the last parenthesis', () => {
    // The command name `a) (b` holds a space and both parentheses; starttime is the 20th field after `)`.
    const fields = ['S', '1', '77', '77', '0', '-1', '4194560', '0', '0', '0', '0', '0', '0', '0', '0', '20', '0', '1', '0', '98765', '1000'];
    const readStat = vi.fn(() => `77 (a) (b) ${fields.join(' ')}\n`);
    expect(processIdentity(77, system({ readStat }))).toBe('77:98765');
    expect(readStat).toHaveBeenCalledWith(77);
  });

  it('on Linux, a process gone before its stat is read has no identity', () => {
    expect(processIdentity(77, system({ readStat: () => { throw enoent(); } }))).toBeNull();
    expect(
      processIdentity(77, system({ readStat: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); } })),
    ).toBeNull();
  });

  it('on Linux, any other read error still throws', () => {
    const denied = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    expect(() => processIdentity(77, system({ readStat: () => { throw denied; } }))).toThrow(denied);
  });

  it('elsewhere, asks ps for the start time, as before', () => {
    const psStart = vi.fn(() => 'Tue Nov 18 22:00:00 2026');
    expect(processIdentity(77, system({ platform: 'darwin', psStart }))).toBe('77:Tue Nov 18 22:00:00 2026');
    expect(psStart).toHaveBeenCalledWith(77);
  });

  it('a dead pid has no identity, without reading anything', () => {
    expect(processIdentity(77, system({ alive: () => false }))).toBeNull();
  });

  it('runs the real system for this process', () => {
    expect(processIdentity(process.pid)).toMatch(new RegExp(`^${String(process.pid)}:\\S`));
  });
});
