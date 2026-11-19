// @vitest-environment node
/**
 * The drift check (HIVE-439): `resources/agents` and `resources/skills` are a
 * copy of the Standard swarm tag recorded in `resources/swarm.lock.json`.
 *
 * When this fails, a file under those folders was changed, added or removed
 * by hand. Edit the Standard swarm in behiques/hivetty-swarms, tag it, then
 * run `pnpm swarm:pull <tag>`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashTree, LOCK_FILE, type SwarmLock } from '../../scripts/swarm-pull.mjs';

const resources = join(__dirname, '..', '..', 'resources');

describe('resources/swarm.lock.json', () => {
  const lock = JSON.parse(readFileSync(join(resources, LOCK_FILE), 'utf8')) as SwarmLock;

  it('locks a standard tag at a full commit', () => {
    expect(lock.tag).toMatch(/^standard\/v\d+\.\d+\.\d+$/);
    expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('matches every file under resources/agents and resources/skills', () => {
    expect(hashTree(resources)).toEqual(lock.files);
  });
});
