import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { HarnessInstalled } from '../port';

/**
 * What the user installed for Copilot themselves (HIVE-362), read and never managed. Run without
 * HiveTTY's `--plugin-dir`, so HiveTTY's own skills are not in it. A plugin skill is
 * `<plugin>:<name>` as Claude's list writes it, the plugin being the folder above `skills/`; Copilot
 * already prefixes a colliding name, which is kept as is. Sessions keep `~/.copilot` (D2), so
 * per-session plugin overrides do not apply: `sessionOverrides` is `{}`.
 */
export const listCopilotSkills = async (bin = 'copilot'): Promise<string> =>
  (await promisify(execFile)(bin, ['skill', 'list', '--json'], { timeout: 10_000 })).stdout;

interface Listed {
  name?: unknown;
  source?: unknown;
  path?: unknown;
  enabled?: unknown;
}

const NOTHING = (): { skills: string[]; plugins: string[] } => ({ skills: [], plugins: [] });

const pluginOf = (path: string): string | undefined => {
  const parts = path.split('/');
  const at = parts.lastIndexOf('skills');
  return at > 0 ? parts[at - 1] : undefined;
};

export function parseCopilotSkillList(output: string): { skills: string[]; plugins: string[] } {
  // A skill Copilot refused is reported in prose after the array (live suite, HIVE-362).
  const end = output.lastIndexOf(']');
  let listed: unknown;
  try {
    listed = JSON.parse(end < 0 ? output : output.slice(0, end + 1));
  } catch {
    return NOTHING();
  }
  if (!Array.isArray(listed)) return NOTHING();
  const skills: string[] = [];
  const plugins = new Set<string>();
  for (const s of listed as Listed[]) {
    if (s.enabled !== true || typeof s.name !== 'string' || s.source === 'builtin') continue;
    const plugin = s.source === 'plugin' && typeof s.path === 'string' ? pluginOf(s.path) : undefined;
    if (plugin !== undefined) plugins.add(plugin);
    skills.push(plugin === undefined || s.name.includes(':') ? s.name : `${plugin}:${s.name}`);
  }
  return { skills, plugins: [...plugins].sort() };
}

export function createCopilotInstalled(list: () => Promise<string> = listCopilotSkills): HarnessInstalled {
  const read = (): Promise<{ skills: string[]; plugins: string[] }> => list().then(parseCopilotSkillList, NOTHING);
  return {
    skillNames: async () => (await read()).skills,
    pluginNames: async () => (await read()).plugins,
    sessionOverrides: () => Promise.resolve({}),
    skillPlaces: '~/.copilot/skills, ~/.agents/skills, the repository’s .github/skills, and your installed plugins',
  };
}
