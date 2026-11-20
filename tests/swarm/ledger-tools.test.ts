// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROJECT_AUTO_MERGE_TOOL } from '@shared/ledger-tools';
import { matches } from '@shared/permission-rules';
import { HAS_SWARM, SWARM_DIR } from '../support/swarm-tree';

/** The swarm's agents against the consent tools (moved from tests/shared/ledger-tools.test.ts, HIVE-448). */
const ROOT = SWARM_DIR;

describe.skipIf(!HAS_SWARM)('PROJECT_AUTO_MERGE_TOOL', () => {
  const qualified = `mcp__hive__${PROJECT_AUTO_MERGE_TOOL.name}`;

  it('is in no shipped agent\'s tools: list', () => {
    const agents = join(ROOT, 'agents');
    const names = readdirSync(agents, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(agents, entry.name, 'AGENT.md')))
      .map((entry) => entry.name);
    expect(names).toContain('shipper');
    for (const name of names) {
      const text = readFileSync(join(agents, name, 'AGENT.md'), 'utf8');
      const list = /^tools:\s*\[(.*)\]\s*$/m.exec(text)?.[1] ?? '';
      const rules = list.split(',').map((rule) => rule.trim()).filter((rule) => rule !== '');
      expect(rules.filter((rule) => matches(rule, qualified, {})), name).toEqual([]);
    }
  });
});
