import { describe, expect, it } from 'vitest';

import { copilotSkills } from '../../../../../electron/main/harness/copilot/skills';

describe('copilotSkills', () => {
  it('is a Claude-format plugin in its own folder, with no /done (HIVE-368)', () => {
    expect(copilotSkills.dir).toBe('plugins/copilot');
    const extras = copilotSkills.extras({ version: '2.0.0', doneUrl: 'http://x/done', root: '/r', skills: [] });
    expect(Object.keys(extras)).toEqual(['.claude-plugin/plugin.json']);
    expect(JSON.parse(extras['.claude-plugin/plugin.json'] ?? '')).toEqual({
      name: 'hive',
      version: '2.0.0',
      description: 'Skills HiveTTY injects into the sessions it starts.',
      skills: ['./skills/'],
    });
  });
});
