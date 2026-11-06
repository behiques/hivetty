// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile, default: { execFile } }));

import {
  CONTAINER_TIMEOUT_MS,
  createSuspender,
  installSuspender,
  isLapsed,
  releaseForQuit,
  RESUME_NOTICE,
  runContainer,
  type Suspender,
} from '../../../../electron/main/licence/suspend';
import type { LicenceState } from '../../../../electron/shared/licence-contract';

function harness() {
  const log: string[] = [];
  const deps = {
    ptyHost: {
      suspendAll: vi.fn(() => {
        log.push('pty:stop');
      }),
      resumeAll: vi.fn((n?: string) => {
        log.push(`pty:cont:${n ?? ''}`);
      }),
    },
    runs: {
      signalAll: vi.fn((s: string) => {
        log.push(`runs:${s}`);
      }),
      containers: vi.fn(() => [{ runtime: 'docker', name: 'box' }]),
    },
    container: vi.fn(async (_r: string, verb: string, name: string) => {
      log.push(`${verb}:${name}`);
    }),
  };
  return { s: createSuspender(deps), deps, log };
}

const LICENSED: LicenceState = { kind: 'licensed', plan: 'team', features: [], limits: {}, exp: 1 };
const GRACE: LicenceState = { kind: 'grace', plan: 'team', features: [], limits: {}, exp: 1 };
const LAPSED: LicenceState = { kind: 'lapsed', reason: 'offline' };

describe('createSuspender', () => {
  it('entering lapsed raises the flag first, then pauses containers, stops the pty-host, then the runs', async () => {
    const { s, log } = harness();
    await s.onState(LAPSED);
    expect(s.lapsed()).toBe(true);
    expect(log).toEqual(['pause:box', 'pty:stop', 'runs:SIGSTOP']);
  });

  it('the flag is up while the pause is still pending, so a spawn mid-suspend is already refused', async () => {
    const { s, deps } = harness();
    let release: () => void = () => undefined;
    deps.container.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    const suspending = s.onState(LAPSED);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.lapsed()).toBe(true);
    expect(deps.ptyHost.suspendAll).not.toHaveBeenCalled();

    release();
    await suspending;
    expect(deps.ptyHost.suspendAll).toHaveBeenCalled();
  });

  it('leaving lapsed continues the pty-host with the notice, then the runs, then unpauses, then lowers the flag', async () => {
    const { s, log } = harness();
    await s.onState(LAPSED);
    log.length = 0;
    await s.onState(LICENSED);
    expect(log).toEqual([`pty:cont:${RESUME_NOTICE}`, 'runs:SIGCONT', 'unpause:box']);
    expect(s.lapsed()).toBe(false);
  });

  it('grace is not lapsed: it resumes too', async () => {
    const { s } = harness();
    await s.onState(LAPSED);
    await s.onState(GRACE);
    expect(s.lapsed()).toBe(false);
  });

  it('unpauses the containers it paused, even if the run that named one has ended', async () => {
    const { s, deps, log } = harness();
    await s.onState(LAPSED);
    deps.runs.containers.mockReturnValue([]);
    log.length = 0;
    await s.onState(LICENSED);
    expect(log).toContain('unpause:box');
  });

  it('unlicensed never suspends, and lapsed to lapsed does nothing twice', async () => {
    const { s, log } = harness();
    await s.onState({ kind: 'unlicensed' });
    expect(log).toEqual([]);
    expect(s.lapsed()).toBe(false);
    await s.onState(LAPSED);
    await s.onState({ kind: 'lapsed', reason: 'payment_failed' });
    expect(log.filter((l) => l === 'pty:stop')).toHaveLength(1);
  });

  it('a fast lapse then renewal never interleaves: the resume waits for the suspend', async () => {
    const { s, deps, log } = harness();
    let release: () => void = () => undefined;
    deps.container.mockImplementationOnce(async (_r: string, verb: string, name: string) => {
      await new Promise<void>((resolve) => (release = resolve));
      log.push(`${verb}:${name}`);
    });

    const suspending = s.onState(LAPSED);
    const resuming = s.onState(LICENSED);
    await Promise.resolve();
    await Promise.resolve();
    release();
    await Promise.all([suspending, resuming]);

    expect(log).toEqual([
      'pause:box',
      'pty:stop',
      'runs:SIGSTOP',
      `pty:cont:${RESUME_NOTICE}`,
      'runs:SIGCONT',
      'unpause:box',
    ]);
    expect(s.lapsed()).toBe(false);
  });

  it('releaseForQuit continues everything without a notice, and is a no-op when not suspended', async () => {
    const { s, log } = harness();
    await s.releaseForQuit();
    expect(log).toEqual([]);
    await s.onState(LAPSED);
    log.length = 0;
    await s.releaseForQuit();
    expect(log).toEqual(['pty:cont:', 'runs:SIGCONT', 'unpause:box']);
  });

  it('a container that fails to pause does not stop the rest', async () => {
    const { s, deps, log } = harness();
    deps.container.mockRejectedValueOnce(new Error('no such container'));
    await s.onState(LAPSED);
    expect(log).toEqual(['pty:stop', 'runs:SIGSTOP']);
  });

  it('a step that throws does not wedge the queue for the next transition', async () => {
    const { s, deps } = harness();
    deps.ptyHost.suspendAll.mockImplementationOnce(() => {
      throw new Error('host gone');
    });
    await expect(s.onState(LAPSED)).rejects.toThrow('host gone');
    await s.onState(LICENSED);
    expect(deps.ptyHost.resumeAll).toHaveBeenCalledWith(RESUME_NOTICE);
    expect(s.lapsed()).toBe(false);
  });
});

describe('the installed suspender', () => {
  afterEach(() => {
    installSuspender(null);
  });

  it('isLapsed is false and releaseForQuit resolves with nothing installed', async () => {
    expect(isLapsed()).toBe(false);
    await expect(releaseForQuit()).resolves.toBeUndefined();
  });

  it('isLapsed follows the installed suspender, and releaseForQuit reaches it', async () => {
    const fake: Suspender = {
      onState: vi.fn(async () => undefined),
      lapsed: vi.fn(() => true),
      releaseForQuit: vi.fn(async () => undefined),
    };
    installSuspender(fake);

    expect(isLapsed()).toBe(true);
    await releaseForQuit();
    expect(fake.releaseForQuit).toHaveBeenCalled();
  });
});

describe('runContainer', () => {
  it('runs `<runtime> <verb> <name>` with the timeout', async () => {
    execFile.mockImplementationOnce((_f: string, _a: string[], _o: unknown, cb: (e: Error | null) => void) => cb(null));

    await runContainer('docker', 'pause', 'box');

    expect(execFile).toHaveBeenCalledWith(
      'docker',
      ['pause', 'box'],
      { timeout: CONTAINER_TIMEOUT_MS },
      expect.any(Function),
    );
  });

  it('resolves, logging, when the runtime fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    execFile.mockImplementationOnce((_f: string, _a: string[], _o: unknown, cb: (e: Error | null) => void) =>
      cb(new Error('No such container: box')),
    );

    await expect(runContainer('podman', 'unpause', 'box')).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('podman unpause box failed'));
    info.mockRestore();
  });
});
