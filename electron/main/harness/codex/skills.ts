import { join } from 'node:path';

import { RESERVED_SKILL_NAME } from '@shared/skills-contract';

import { DONE_DESCRIPTION, doneToolSkill } from '../done-tool-skill';
import type { HarnessSkills } from '../port';

/**
 * Codex's folder (HIVE-369). Codex has no flag that adds a skills directory, so HIVE-360 hands the
 * model `catalog.md` as session instructions, one line per skill in Codex's own catalog format.
 * Host paths; HIVE-360 maps them for a container.
 */
export const codexSkills: HarnessSkills = {
  dir: 'plugins/codex',
  extras: ({ root, skills }) => ({
    'catalog.md': [
      '### HiveTTY skills',
      'Skills like the ones above. When the user names one with $name or in plain text, read its SKILL.md before acting.',
      // HIVE-368: `done` is not in `skills` (its name is reserved), so it joins the catalog here.
      ...[...skills, { name: RESERVED_SKILL_NAME, description: DONE_DESCRIPTION }].map(
        ({ name, description }) =>
          `- ${name}:${description === '' ? '' : ` ${description}`} (file: ${join(root, 'skills', name, 'SKILL.md')})`,
      ),
      '',
    ].join('\n'),
    [`skills/${RESERVED_SKILL_NAME}/SKILL.md`]: doneToolSkill('codex'),
  }),
};
