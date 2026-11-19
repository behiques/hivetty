// @vitest-environment node
import type { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { forkPtyHost } from '../../server/pty-host-fork';

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 4242 as number | undefined,
    connected: true,
    send: vi.fn(),
    kill: vi.fn(() => true),
  });
}

function make(user?: { uid: number; gid: number }) {
  const child = fakeChild();
  const forkFn = vi.fn(() => child);
  const host = forkPtyHost({ entry: '/app/server/pty-host.js', user, fork: forkFn as unknown as typeof fork });
  return { child, forkFn, host };
}

describe('forkPtyHost (HIVE-423)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forks the entry with structured clone, an IPC channel and inherited output', () => {
    const { forkFn } = make();
    expect(forkFn).toHaveBeenCalledWith('/app/server/pty-host.js', [], {
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
  });

  it('passes uid and gid only when a host user is given', () => {
    const { forkFn } = make({ uid: 1001, gid: 1002 });
    expect((forkFn.mock.calls[0] as unknown[])[2]).toMatchObject({ uid: 1001, gid: 1002 });
  });

  it('reads the pid live, and kills the child', () => {
    const { child, host } = make();
    expect(host.pid).toBe(4242);
    child.pid = undefined;
    expect(host.pid).toBeUndefined();
    expect(host.kill()).toBe(true);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('sends while connected and drops after', () => {
    const { child, host } = make();
    host.postMessage({ type: 'ping', seq: 1 });
    expect(child.send).toHaveBeenCalledWith({ type: 'ping', seq: 1 });
    child.connected = false;
    host.postMessage({ type: 'ping', seq: 2 });
    expect(child.send).toHaveBeenCalledTimes(1);
  });

  it('passes message and spawn through', () => {
    const { child, host } = make();
    const onMessage = vi.fn();
    const onSpawn = vi.fn();
    host.on('message', onMessage);
    host.on('spawn', onSpawn);
    child.emit('spawn');
    child.emit('message', { type: 'pong', seq: 1 });
    expect(onSpawn).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: 'pong', seq: 1 });
  });

  it('reports an exit code, and 1 for a signalled child', () => {
    const first = make();
    const onExit = vi.fn();
    first.host.on('exit', onExit);
    first.child.emit('exit', 7, null);
    expect(onExit).toHaveBeenCalledWith(7);

    const second = make();
    const onSignal = vi.fn();
    second.host.on('exit', onSignal);
    second.child.emit('exit', null, 'SIGKILL');
    expect(onSignal).toHaveBeenCalledWith(1);
  });

  it('reports a host that never started as one exit, and logs why', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { child, host } = make();
    const onExit = vi.fn();
    host.on('exit', onExit);
    child.emit('error', new Error('spawn EPERM'));
    child.emit('exit', null, null);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith('[pty-host] spawn EPERM');
  });

  it('an error after spawn reports no exit of its own', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { child, host } = make();
    const onExit = vi.fn();
    host.on('exit', onExit);
    child.emit('spawn');
    child.emit('error', new Error('send failed'));
    expect(onExit).not.toHaveBeenCalled();
    child.emit('exit', 0, null);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(0);
  });
});
