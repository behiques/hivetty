// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HIVE_TOOL_NAMES } from '../../../../electron/shared/ledger-tools';
import { portabilityIssues, renderSkillText } from '../../../../electron/shared/skill-render';

const ROOT = join(process.cwd(), 'resources', 'skills');

const md = async (): Promise<string[]> => {
  const all = await readdir(ROOT, { recursive: true });
  return all.filter((path) => path.endsWith('.md'));
};

describe('shipped skills (HIVE-369)', () => {
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
