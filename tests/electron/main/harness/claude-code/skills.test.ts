import { describe, expect, it } from 'vitest';

import { doneSkill } from '../../../../../electron/main/harness/claude-code/done-skill';
import { claudeSkills } from '../../../../../electron/main/harness/claude-code/skills';

describe('claudeSkills', () => {
  it('lands where --plugin-dir has always pointed', () => {
    expect(claudeSkills.dir).toBe('plugin');
  });
  it('writes the manifest and /done beside the skills', () => {
    const extras = claudeSkills.extras({ version: '1.2.3', doneUrl: null, root: '/r', skills: [] });
    expect(Object.keys(extras).sort()).toEqual(['.claude-plugin/plugin.json', 'skills/done/SKILL.md']);
    expect(JSON.parse(extras['.claude-plugin/plugin.json'] ?? '')).toEqual({
      name: 'hive',
      version: '1.2.3',
      description: 'Skills HiveTTY injects into the sessions it starts.',
      skills: ['./skills/'],
    });
    expect(extras['skills/done/SKILL.md']).toBe(doneSkill(null));
  });
});
