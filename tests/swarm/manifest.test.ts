// @vitest-environment node
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readSwarm } from '../../core/swarms/manifest';
import { HAS_SWARM, SWARM_DIR } from '../support/swarm-tree';

/** The swarm read whole (moved from tests/core/swarms/manifest.test.ts, HIVE-448): the checkout has its own swarm.json. */
describe.skipIf(!HAS_SWARM)('readSwarm', () => {
  it('reads the swarm with no problems', async () => {
    const read = await readSwarm(SWARM_DIR);

    expect(read.problems).toEqual([]);
    expect(read.contents.agents.map((agent) => agent.name)).toEqual(['acr', 'builder', 'fixer', 'shipper']);
    // 13 once Dev Squad 1.1.0 folds `ship` into the shipper agent.
    expect(read.contents.skills).toHaveLength(existsSync(join(SWARM_DIR, 'skills', 'ship', 'SKILL.md')) ? 14 : 13);
    for (const skill of read.contents.skills) expect(skill.description).not.toBe('');
    expect(read.contents.agents.find((agent) => agent.name === 'builder')?.tools).toContain(
      'mcp__hive__jira_transition',
    );
  });
});
