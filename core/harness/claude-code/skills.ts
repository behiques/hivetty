import { RESERVED_SKILL_NAME } from '@shared/skills-contract';

import type { HarnessSkills } from '../port';

import { doneSkill } from './done-skill';

/**
 * The manifest that makes a directory a plugin.
 *
 * `skills: ['./skills/']` is declared rather than left to auto-discovery.
 * Auto-discovery may well work, but every real installed plugin on this machine
 * declares the field — matching what the binary is demonstrably given beats
 * relying on a default that is not ours to guarantee and would fail silently.
 */
export const manifest = (version: string): string =>
  `${JSON.stringify(
    {
      name: 'hive',
      version,
      description: 'Skills HiveTTY injects into the sessions it starts.',
      skills: ['./skills/'],
    },
    null,
    2,
  )}\n`;

/** Claude Code's folder: the plugin `--plugin-dir` loads, with the app-owned `/done` (HIVE-96, HIVE-93). */
export const claudeSkills: HarnessSkills = {
  dir: 'plugin',
  extras: ({ version, doneUrl }) => ({
    '.claude-plugin/plugin.json': manifest(version),
    [`skills/${RESERVED_SKILL_NAME}/SKILL.md`]: doneSkill(doneUrl),
  }),
};
