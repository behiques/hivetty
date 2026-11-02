// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { frontmatter } from '../../../../electron/main/skills/read';
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

  it('render for Claude Code with no placeholder or requires: left', async () => {
    for (const path of await md()) {
      const out = renderSkillText(await readFile(join(ROOT, path), 'utf8'), 'claude-code');
      expect(out, path).not.toMatch(/\{\{(tool|skill):|\{\{plugin_root\}\}/);
      expect(out, path).not.toMatch(/^requires:/m);
    }
  });

  it('declare what pr-review and goal-on need', async () => {
    const keys = async (name: string) => frontmatter(await readFile(join(ROOT, name, 'SKILL.md'), 'utf8'));
    expect((await keys('pr-review'))?.requires).toBe('[subagents]');
    expect((await keys('goal-on'))?.requires).toBe('[stop-hook]');
  });
});
