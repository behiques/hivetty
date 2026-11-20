// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderSkillText } from '../../shared/skill-render';
import { HAS_SWARM, SWARM_DIR } from '../support/swarm-tree';

/** goal-on's text, rendered per CLI (moved from tests/core/skills/render.test.ts, HIVE-448). */
const ROOT = SWARM_DIR;

describe.skipIf(!HAS_SWARM)('per CLI (HIVE-369)', () => {
  it('tells every CLI how the brief is named and which verifiers run (HIVE-370)', () => {
    const source = readFileSync(join(ROOT, 'skills/goal-on/SKILL.md'), 'utf8');
    for (const cli of ['claude-code', 'codex', 'copilot'] as const) {
      const text = renderSkillText(source, cli, '/root');
      expect(text).toContain('`~/.hivetty/goals/<$HIVE_SESSION_ID>.md`');
      expect(text).toContain('on Codex and Copilot only the command verifier runs');
    }
  });
});
