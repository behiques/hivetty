import type { HarnessSkills } from '../port';

/**
 * Copilot's folder (HIVE-369): Copilot 1.0.105 reads a Claude-format plugin as it is, so HIVE-362
 * passes this as a second `--plugin-dir`. Its own manifest string, so Claude's file never changes
 * because this one did. No `/done` until HIVE-368's `session_done`.
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

export const copilotSkills: HarnessSkills = {
  dir: 'plugins/copilot',
  extras: ({ version }) => ({ '.claude-plugin/plugin.json': manifest(version) }),
};
