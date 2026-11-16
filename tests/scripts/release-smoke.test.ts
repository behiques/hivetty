import { describe, expect, it } from 'vitest';

import {
  builderArgs,
  describeExit,
  findAppBinary,
  isInside,
  launchPlan,
  tailLines,
} from '../../scripts/release-smoke.mjs';

/**
 * HIVE-417 item 10: the release smoke packages and launches the app outside the
 * checkout. The I/O half is proven by running it; these pin the pure half,
 * the parts whose mistakes would only show as a smoke that passes for the
 * wrong reason.
 */
describe('builderArgs', () => {
  it('packages a directory build into the given folder and never publishes', () => {
    expect(builderArgs('/tmp/smoke-x/dist')).toEqual([
      '--mac',
      '--arm64',
      '--dir',
      '--publish',
      'never',
      '-c.directories.output=/tmp/smoke-x/dist',
      '-c.mac.identity=null',
      '-c.mac.notarize=false',
    ]);
  });
});

describe('findAppBinary', () => {
  it('finds the one .app under mac-arm64 and its executable', () => {
    const entries = { '/o': ['mac-arm64', 'builder-debug.yml'], '/o/mac-arm64': ['HiveTTY Pro.app'] };
    const list = (dir: string) => entries[dir as keyof typeof entries] ?? [];

    expect(findAppBinary('/o', list)).toBe('/o/mac-arm64/HiveTTY Pro.app/Contents/MacOS/HiveTTY Pro');
  });

  it('returns null when the build produced no .app', () => {
    expect(findAppBinary('/o', () => [])).toBeNull();
  });
});

describe('launchPlan', () => {
  it('points the profile and the hive folder into the temp folder', () => {
    const plan = launchPlan('/b/HiveTTY Pro', '/tmp/smoke-x', { PATH: '/usr/bin' });

    expect(plan.command).toBe('/b/HiveTTY Pro');
    expect(plan.args).toEqual(['--user-data-dir=/tmp/smoke-x/profile']);
    expect(plan.env).toEqual({
      PATH: '/usr/bin',
      HIVE_CONFIG_PATH: '/tmp/smoke-x/profile/config.json',
      HIVE_BACKGROUND: '1',
    });
  });

  it('drops an inherited HIVE_CONFIG_PATH rather than sharing the person\'s hive folder', () => {
    const plan = launchPlan('/b/x', '/tmp/s', { HIVE_CONFIG_PATH: '/Users/me/.hivetty/config.json' });

    expect(plan.env.HIVE_CONFIG_PATH).toBe('/tmp/s/profile/config.json');
  });
});

describe('isInside', () => {
  it('refuses a temp folder inside the checkout', () => {
    expect(isInside('/repo/tmp/smoke', '/repo')).toBe(true);
    expect(isInside('/repo', '/repo')).toBe(true);
    expect(isInside('/var/folders/x/smoke', '/repo')).toBe(false);
    expect(isInside('/repository', '/repo')).toBe(false);
  });
});

describe('describeExit', () => {
  it('names an early death with its code and stderr tail', () => {
    expect(describeExit({ code: 1, signal: null, stderr: 'a\nb\nFATAL: no helper\n' }, 2)).toBe(
      'The app exited before the smoke window ended (code 1).\nb\nFATAL: no helper',
    );
  });

  it('names a signal when there is no code', () => {
    expect(describeExit({ code: null, signal: 'SIGTRAP', stderr: '' }, 5)).toBe(
      'The app exited before the smoke window ended (signal SIGTRAP).\n(no stderr)',
    );
  });
});

describe('tailLines', () => {
  it('keeps the last n non-empty lines', () => {
    expect(tailLines('1\n2\n\n3\n', 2)).toBe('2\n3');
  });
});
