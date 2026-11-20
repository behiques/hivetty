// @vitest-environment node
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedShipped } from '../../core/seed/seed';
import { readUserSkills } from '../../core/skills/read';
import { HAS_SWARM, SWARM_DIR } from '../support/swarm-tree';

/** The swarm seeded into a tree the reader accepts (moved from tests/core/seed/seed.test.ts, HIVE-448). */
let base: string;
let target: string;
let manifestFile: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'hive-seed-'));
  target = join(base, 'hive');
  manifestFile = join(target, '.seed.json');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe.skipIf(!HAS_SWARM)('seedShipped', () => {
  it('seeds the swarm into a tree the reader accepts whole', async () => {
    const report = await seedShipped({ source: SWARM_DIR, target, manifestFile });

    expect(report.created.length).toBeGreaterThan(0);
    expect(report.created).toEqual(
      expect.arrayContaining([
        'agents/shipper/AGENT.md',
        'agents/acr/AGENT.md',
        'agents/fixer/AGENT.md',
        'agents/builder/AGENT.md',
      ]),
    );
    const read = await readUserSkills(join(target, 'skills'));
    expect(read.invalid).toEqual([]);
    // Dev Squad 1.1.0 folds `ship` into the shipper agent; a swarm from before still carries it.
    const shipsShip = existsSync(join(SWARM_DIR, 'skills', 'ship', 'SKILL.md'));
    expect(read.skills.map((entry) => entry.name)).toEqual([
      'brainstorm',
      'debug',
      'execute',
      'goal-on',
      'merge-pr',
      'plan',
      'pr-review',
      'review-pr-findings',
      ...(shipsShip ? ['ship'] : []),
      'spec-deviation',
      'tdd',
      'verify',
      'work-on',
      'worktree',
    ]);
  });
});
