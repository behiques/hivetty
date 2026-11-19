// @vitest-environment node
/**
 * The drift check (HIVE-439): `resources/agents` and `resources/skills` are a
 * copy of the Standard swarm tag recorded in `resources/swarm.lock.json`.
 *
 * When this fails, a file under those folders was changed, added or removed
 * by hand. Edit the Standard swarm in behiques/hivetty-swarms, tag it, then
 * run `pnpm swarm:pull <tag>`.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashTree, readLock } from '../../scripts/swarm-pull.mjs';

const resources = join(__dirname, '..', '..', 'resources');

// Read inside each test, so a missing or truncated lock fails as a test with readLock's
// "run pnpm swarm:pull" message rather than as a collection error.
describe('resources/swarm.lock.json', () => {
  it('locks a standard tag at a full commit', () => {
    const lock = readLock(resources);

    expect(lock.tag).toMatch(/^standard\/v\d+\.\d+\.\d+$/);
    expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('matches every file under resources/agents and resources/skills', () => {
    expect(hashTree(resources)).toEqual(readLock(resources).files);
  });
});
