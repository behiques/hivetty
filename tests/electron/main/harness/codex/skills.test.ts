import { describe, expect, it } from 'vitest';

import { codexSkills } from '../../../../../electron/main/harness/codex/skills';
import { DONE_DESCRIPTION, doneToolSkill } from '../../../../../electron/main/harness/done-tool-skill';

describe('codexSkills', () => {
  it('lands in its own folder', () => {
    expect(codexSkills.dir).toBe('plugins/codex');
  });
  it('writes the catalog HIVE-360 puts in the session instructions', () => {
    const extras = codexSkills.extras({
      version: '1',
      doneUrl: null,
      root: '/u/hive/plugins/codex',
      skills: [
        { name: 'plan', description: 'Write a plan.' },
        { name: 'tdd', description: '' },
      ],
    });
    expect(extras).toEqual({
      'catalog.md': [
        '### HiveTTY skills',
        'Skills like the ones above. When the user names one with $name or in plain text, read its SKILL.md before acting.',
        '- hive-plan: Write a plan. (file: /u/hive/plugins/codex/skills/plan/SKILL.md)',
        '- hive-tdd: (file: /u/hive/plugins/codex/skills/tdd/SKILL.md)',
        `- hive-done: ${DONE_DESCRIPTION} (file: /u/hive/plugins/codex/skills/done/SKILL.md)`,
        '',
      ].join('\n'),
      'skills/done/SKILL.md': doneToolSkill('codex'),
    });
  });
});
