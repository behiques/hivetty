import { describe, expect, it } from 'vitest';

import { copilotSkills } from '../../../../../electron/main/harness/copilot/skills';
import { doneToolSkill } from '../../../../../electron/main/harness/done-tool-skill';

describe('copilotSkills', () => {
  it('is a Claude-format plugin in its own folder, with done naming session_done (HIVE-368)', () => {
    expect(copilotSkills.dir).toBe('plugins/copilot');
    const extras = copilotSkills.extras({ version: '2.0.0', doneUrl: 'http://x/done', root: '/r', skills: [] });
    expect(Object.keys(extras)).toEqual(['.claude-plugin/plugin.json', 'skills/done/SKILL.md']);
    expect(extras['skills/done/SKILL.md']).toEqual(doneToolSkill('copilot'));
    expect(JSON.parse(extras['.claude-plugin/plugin.json'] ?? '')).toEqual({
      name: 'hive',
      version: '2.0.0',
      description: 'Skills HiveTTY injects into the sessions it starts.',
      skills: ['./skills/'],
    });
  });
});
