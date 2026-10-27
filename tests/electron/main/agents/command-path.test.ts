import { describe, expect, it } from 'vitest';

import { resolveCommand } from '../../../../electron/main/agents/command-path';

/** Pretend exactly these paths are executable files. */
const executable = (...paths: string[]) => (p: string) => paths.includes(p);

describe('resolveCommand', () => {
  it('uses an absolute path as-is when it is executable', () => {
    expect(
      resolveCommand('/opt/bin/claude', undefined, executable('/opt/bin/claude')),
    ).toEqual({ path: '/opt/bin/claude' });
  });

  it('refuses an absolute path that is not executable', () => {
    const result = resolveCommand('/opt/bin/claude', undefined, executable());

    expect(result).toEqual({ problem: expect.stringContaining('/opt/bin/claude') });
  });

  it('scans PATH in order and takes the first hit', () => {
    expect(
      resolveCommand(
        'claude',
        '/a:/b:/c',
        executable('/b/claude', '/c/claude'),
      ),
    ).toEqual({ path: '/b/claude' });
  });

  /**
   * A space in an absolute path is not an argument. Refusing this one told the
   * user to "set Settings › Runtime to a plain path" — which is exactly what
   * they had done, on a perfectly ordinary macOS path.
   */
  it('accepts an absolute path containing a space when the file is really there', () => {
    const path = '/Users/me/Application Support/bin/claude';

    expect(resolveCommand(path, undefined, executable(path))).toEqual({ path });
  });

  it('still refuses an absolute-looking command with arguments, which no file backs', () => {
    const result = resolveCommand('/opt/bin/claude --tel', undefined, executable());

    expect(result).toEqual({ problem: expect.stringContaining('arguments') });
  });

  it('refuses a command carrying arguments rather than splitting it', () => {
    const result = resolveCommand('claude --tel', '/a', executable('/a/claude'));

    expect(result).toEqual({ problem: expect.stringContaining('arguments') });
  });

  it('refuses when PATH is unset', () => {
    const result = resolveCommand('claude', undefined, executable('/a/claude'));

    expect(result).toEqual({ problem: expect.stringContaining('PATH') });
  });

  it('refuses when nothing on PATH matches', () => {
    const result = resolveCommand('claude', '/a:/b', executable());

    expect(result).toEqual({ problem: expect.stringContaining('claude') });
  });

  it("names the CLI in its refusals when told which one (byte-identical to main's Claude strings)", () => {
    expect(resolveCommand('', '/a', executable(), 'claude')).toEqual({
      problem: 'No claude command is configured.',
    });
    expect(resolveCommand('claude --tel', '/a', executable(), 'claude')).toEqual({
      problem:
        'The configured claude command `claude --tel` carries arguments. ' +
        'An agent is spawned without a shell, so it needs a single ' +
        'executable — set Settings › Runtime to a plain path.',
    });
    expect(resolveCommand('', '/a', executable(), 'codex')).toEqual({
      problem: 'No codex command is configured.',
    });
  });

  it('names no CLI in its refusals when not told which', () => {
    expect(resolveCommand('', '/a')).toEqual({ problem: 'No command is configured.' });
    expect(resolveCommand('claude --tel', '/a', executable())).toEqual({
      problem: expect.stringMatching(/^The configured command `claude --tel` carries arguments\./),
    });
  });
});
