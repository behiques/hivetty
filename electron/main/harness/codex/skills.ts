import { join } from 'node:path';

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
      ...skills.map(
        ({ name, description }) =>
          `- ${name}:${description === '' ? '' : ` ${description}`} (file: ${join(root, 'skills', name, 'SKILL.md')})`,
      ),
      '',
    ].join('\n'),
  }),
};
