// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { SWARMS_DIR, swarmPaths } from '../../../core/swarms/paths';

describe('swarmPaths', () => {
  const paths = swarmPaths('/h');

  it('names every path under the swarms folder', () => {
    expect(SWARMS_DIR).toBe('swarms');
    expect(paths.root).toBe('/h/swarms');
    expect(paths.installed).toBe('/h/swarms/installed.json');
    expect(paths.registry).toBe('/h/swarms/registry.json');
    expect(paths.askpass).toBe('/h/swarms/askpass.sh');
    expect(paths.dir('x')).toBe('/h/swarms/x');
    expect(paths.repo('x')).toBe('/h/swarms/x/repo');
    expect(paths.staging('x')).toBe('/h/swarms/x/repo.new');
    expect(paths.seed('x')).toBe('/h/swarms/x/seed.json');
  });

  it.each<[string, () => string]>([
    ["dir('../x')", () => paths.dir('../x')],
    ["repo('a/b')", () => paths.repo('a/b')],
    ["staging('')", () => paths.staging('')],
    ["seed('..')", () => paths.seed('..')],
  ])('%s throws, so a bad id never becomes a path', (_label, call) => {
    expect(call).toThrow('not a swarm id');
  });
});
