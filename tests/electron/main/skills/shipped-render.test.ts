// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderSkillText } from '../../../../electron/shared/skill-render';

const ROOT = join(process.cwd(), 'resources', 'skills');

const md = async (): Promise<string[]> => {
  const all = await readdir(ROOT, { recursive: true });
  return all.filter((path) => path.endsWith('.md'));
};

describe('shipped skills (HIVE-369)', () => {
  it('write hive tools and skills only as placeholders', async () => {
    for (const path of await md()) {
      const text = await readFile(join(ROOT, path), 'utf8');
      expect(text, path).not.toMatch(/mcp__hive__[a-z]/);
      expect(text, path).not.toMatch(/`hive:[a-z]/);
      expect(text, path).not.toContain('$CLAUDE_PLUGIN_ROOT');
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
