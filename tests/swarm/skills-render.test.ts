// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HIVE_TOOL_NAMES } from '../../shared/ledger-tools';
import { portabilityIssues, renderSkillText } from '../../shared/skill-render';
import { HAS_SWARM, SWARM_DIR } from '../support/swarm-tree';

const ROOT = join(SWARM_DIR, 'skills');

const md = async (): Promise<string[]> => {
  const all = await readdir(ROOT, { recursive: true });
  return all.filter((path) => path.endsWith('.md'));
};

describe.skipIf(!HAS_SWARM)('shipped skills (HIVE-369)', () => {
  it('are portable: no CLI-specific name and no dangling placeholder', async () => {
    const skills = ['done', ...(await readdir(ROOT))];
    for (const path of await md()) {
      const text = await readFile(join(ROOT, path), 'utf8');
      expect(portabilityIssues(text, { tools: HIVE_TOOL_NAMES, skills }), path).toEqual([]);
    }
  });

  it('render for every CLI with no placeholder left', async () => {
    for (const path of await md()) {
      const text = await readFile(join(ROOT, path), 'utf8');
      for (const cli of ['claude-code', 'codex', 'copilot'] as const) {
        expect(renderSkillText(text, cli), `${cli} ${path}`).not.toMatch(/\{\{(tool|skill):|\{\{plugin_root\}\}/);
      }
    }
  });
});
