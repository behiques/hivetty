// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { autoMergeRules } from '../../core/agents/auto-merge';
import type { RepoRef } from '../../core/integrations/github/query';
import { matches } from '../../shared/permission-rules';
import { HAS_SWARM, SWARM_DIR } from '../support/swarm-tree';

/** merge-pr's merge line against the auto-merge rule (moved from tests/core/agents/auto-merge.test.ts, HIVE-448). */
const ROOT = SWARM_DIR;

const hive: RepoRef = { owner: 'yunidbauza', name: 'the-hive' };

describe.skipIf(!HAS_SWARM)('autoMergeRule', () => {
  it('matches the merge line merge-pr documents, explicit squash message included (HIVE-349)', () => {
    const skill = readFileSync(join(ROOT, 'skills/merge-pr/SKILL.md'), 'utf8');
    const line = skill.split('\n').find((l) => l.startsWith('gh pr merge <N> --squash'));
    const command = line!
      .replaceAll('<N>', '214')
      .replace('<the SHA the CLEAR line printed>', '0211110354')
      .replace('<PR title, stripped>', 'Plan tab follows the builder')
      .replace('<KEY> · ', 'HIVE-349 · ')
      .replaceAll('<owner>/<repo>', 'yunidbauza/the-hive');

    // GitHub's default squash body lists every commit and a Co-authored-by line per author.
    expect(command).toContain('--subject "Plan tab follows the builder (#214)"');
    expect(command).toContain('--body "HIVE-349 · https://github.com/yunidbauza/the-hive/pull/214"');
    expect(command).not.toContain('<');
    expect(matches(autoMergeRules(hive)[0]!, 'Bash', { command })).toBe(true);
  });
});
