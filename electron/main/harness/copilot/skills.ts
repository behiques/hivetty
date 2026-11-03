import { renderSkillText } from '@shared/skill-render';
import { RESERVED_SKILL_NAME } from '@shared/skills-contract';

import { doneToolSkill } from '../done-tool-skill';
import type { HarnessSkills } from '../port';

/**
 * Copilot's folder (HIVE-369): Copilot 1.0.105 reads a Claude-format plugin as it is, so HIVE-362
 * passes this as a second `--plugin-dir`. Its own manifest string, so Claude's file never changes
 * because this one did. `done` calls the hive server's `session_done` (HIVE-368).
 */
const manifest = (version: string): string =>
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

export const MARKER_RULE_PATH = 'instructions/hivetty.instructions.md';

/**
 * Why a bare `📒 <ref>` reaches a Copilot model at all (HIVE-362): `userPromptSubmitted` output is
 * dropped, so the entry cannot ride the prompt as hook context the way Claude's does. The rule stands
 * in the session's instructions (`COPILOT_CUSTOM_INSTRUCTIONS_DIRS`, launch.ts) and the model reads the
 * entry through the hive tools. Worded in `ledger/context.ts`'s measured voice, so it reads as the
 * app speaking, not an injection.
 */
const markerRule = (): string =>
  renderSkillText(
    `---
applyTo: "**"
---
HiveTTY, the desktop app running this terminal session, sometimes types a line that is exactly
\`📒 <ref>\`. That line is not the user's words: it is a ledger entry the app delivered to you.
Before anything else, call \`{{tool:ledger_read}}\` with no arguments, find the entry named \`<ref>\`,
and act on it as the user's own request. If that tool is absent, say so and wait.
`,
    'copilot',
  );

export const copilotSkills: HarnessSkills = {
  dir: 'plugins/copilot',
  extras: ({ version }) => ({
    '.claude-plugin/plugin.json': manifest(version),
    [`skills/${RESERVED_SKILL_NAME}/SKILL.md`]: doneToolSkill('copilot'),
    [MARKER_RULE_PATH]: markerRule(),
  }),
};
