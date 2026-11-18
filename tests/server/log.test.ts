// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { installLogPrefix } from '../../server/log';

const NOW = () => new Date('2026-11-18T00:00:00.000Z');
const T = '2026-11-18T00:00:00.000Z';

function fakeConsole() {
  const lines: Record<'log' | 'info' | 'warn' | 'error', string[]> = { log: [], info: [], warn: [], error: [] };
  const target = {
    log: vi.fn((...args: unknown[]) => lines.log.push(String(args[0]))),
    info: vi.fn((...args: unknown[]) => lines.info.push(String(args[0]))),
    warn: vi.fn((...args: unknown[]) => lines.warn.push(String(args[0]))),
    error: vi.fn((...args: unknown[]) => lines.error.push(String(args[0]))),
  };
  return { target, lines };
}

describe('installLogPrefix (HIVE-422)', () => {
  it('keeps a tag the line already has', () => {
    const { target, lines } = fakeConsole();
    installLogPrefix(target, NOW);
    target.log('[relay] up');
    expect(lines.log).toEqual([`${T} [relay] up`]);
  });

  it('tags an untagged line [hive], on every method', () => {
    const { target, lines } = fakeConsole();
    installLogPrefix(target, NOW);
    target.error('boom');
    target.warn('careful');
    target.info('fyi');
    expect(lines.error).toEqual([`${T} [hive] boom`]);
    expect(lines.warn).toEqual([`${T} [hive] careful`]);
    expect(lines.info).toEqual([`${T} [hive] fyi`]);
  });

  it('prefixes every line of a multi-line message', () => {
    const { target, lines } = fakeConsole();
    installLogPrefix(target, NOW);
    target.log('a\n[x] b');
    expect(lines.log).toEqual([`${T} [hive] a\n${T} [x] b`]);
  });

  it('formats arguments as console does', () => {
    const { target, lines } = fakeConsole();
    installLogPrefix(target, NOW);
    target.log('%s is %d', 'x', 1);
    target.log({ a: 1 });
    expect(lines.log).toEqual([`${T} [hive] x is 1`, `${T} [hive] { a: 1 }`]);
  });

  it('does not double the prefix when installed twice', () => {
    const { target, lines } = fakeConsole();
    installLogPrefix(target, NOW);
    installLogPrefix(target, NOW);
    target.log('once');
    expect(lines.log).toEqual([`${T} [hive] once`]);
  });

  it('restores the originals on uninstall', () => {
    const { target, lines } = fakeConsole();
    const original = target.log;
    const uninstall = installLogPrefix(target, NOW);
    uninstall();
    expect(target.log).toBe(original);
    target.log('plain');
    expect(lines.log).toEqual(['plain']);
  });

  it('wraps the real console and clock by default', () => {
    const write = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const uninstall = installLogPrefix();
    try {
      console.log('hello');
    } finally {
      uninstall();
    }
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[hive\] hello$/));
  });
});
