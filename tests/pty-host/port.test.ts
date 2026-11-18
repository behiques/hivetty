// @vitest-environment node
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { HostPort } from '../../pty-host/host';
import { hostPort, type HostProcess } from '../../pty-host/port';

function forked(): EventEmitter & { send: ReturnType<typeof vi.fn>; connected: boolean } {
  return Object.assign(new EventEmitter(), { send: vi.fn(), connected: true });
}

describe('hostPort (HIVE-423)', () => {
  it('answers parentPort when the process has one', () => {
    const parentPort: HostPort = { postMessage: vi.fn(), on: vi.fn() };
    const proc = Object.assign(forked(), { parentPort });
    expect(hostPort(proc as unknown as HostProcess)).toBe(parentPort);
  });

  it('answers null with neither a parentPort nor an IPC channel', () => {
    expect(hostPort(new EventEmitter() as unknown as HostProcess)).toBeNull();
  });

  it('wraps each message from the fork channel as { data }', () => {
    const proc = forked();
    const seen: unknown[] = [];
    hostPort(proc as unknown as HostProcess)!.on('message', (event) => seen.push(event));
    proc.emit('message', { type: 'ping', seq: 1 });
    expect(seen).toEqual([{ data: { type: 'ping', seq: 1 } }]);
  });

  it('sends while connected and drops after', () => {
    const proc = forked();
    const port = hostPort(proc as unknown as HostProcess)!;
    port.postMessage({ type: 'pong', seq: 1 });
    expect(proc.send).toHaveBeenCalledWith({ type: 'pong', seq: 1 });
    proc.connected = false;
    port.postMessage({ type: 'pong', seq: 2 });
    expect(proc.send).toHaveBeenCalledTimes(1);
  });

  it('delivers a closed channel as one shutdown command', () => {
    const proc = forked();
    const seen: unknown[] = [];
    hostPort(proc as unknown as HostProcess)!.on('message', (event) => seen.push(event));
    proc.emit('disconnect');
    expect(seen).toEqual([{ data: { type: 'shutdown' } }]);
  });

  it('does not shut down twice when the channel closes after a shutdown command', () => {
    const proc = forked();
    const seen: unknown[] = [];
    hostPort(proc as unknown as HostProcess)!.on('message', (event) => seen.push(event));
    proc.emit('message', { type: 'shutdown' });
    proc.emit('disconnect');
    expect(seen).toEqual([{ data: { type: 'shutdown' } }]);
  });
});
