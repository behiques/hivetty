import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import type { HarnessInstalled } from '../port';

/**
 * What the user installed for Codex themselves (HIVE-367), read and never managed. Codex's own
 * `debug prompt-input` renders the catalog it shows the model, so the names are Codex's: it
 * scans recursively, prefixes a plugin skill (and a skill symlinked into a plugin) with the
 * plugin, honours `[[skills.config]] enabled = false`, and drops dangling links. Reading the
 * folders ourselves would re-implement all of that and drift (spec D1). Bundled skills live
 * under a `.system` root and are left out, as Copilot's `builtin` ones are.
 */

interface Item {
  content?: { text?: unknown }[];
}

const ROOT = /^- `(r\d+)` = `([^`]+)`$/;
const SKILL = /^- (\S+?): .*\(file: ([^)]+)\)\s*$/;

const textOf = (output: string): string => {
  let items: unknown;
  try {
    items = JSON.parse(output);
  } catch {
    return '';
  }
  if (!Array.isArray(items)) return '';
  return (items as Item[])
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n');
};

export function parseCodexSkillCatalog(output: string): string[] {
  const roots = new Map<string, string>();
  const names: string[] = [];
  let inCatalog = false;
  for (const line of textOf(output).split('\n')) {
    const root = ROOT.exec(line);
    if (root) roots.set(root[1], root[2]);
    if (line.startsWith('#')) {
      inCatalog = line.trim() === '### Available skills';
      continue;
    }
    const skill = inCatalog ? SKILL.exec(line) : null;
    if (!skill) continue;
    const [alias, ...rest] = skill[2].split('/');
    const path = roots.has(alias) ? [roots.get(alias), ...rest].join('/') : skill[2];
    if (!path.includes('/.system/')) names.push(skill[1]);
  }
  return names;
}

export const CODEX_SKILL_PLACES =
  '~/.agents/skills, ~/.codex/skills, /etc/codex/skills, the repository’s .agents/skills, and your enabled plugins';

/** Run from the home directory: the reader has no session cwd, so no repository's skills (spec D2). */
export const listCodexPrompt = async (bin = 'codex'): Promise<string> =>
  (
    await promisify(execFile)(bin, ['debug', 'prompt-input', 'x'], {
      cwd: homedir(),
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout;

export function createCodexInstalled(list: () => Promise<string> = listCodexPrompt): HarnessInstalled {
  const read = (): Promise<string[]> => list().then(parseCodexSkillCatalog, () => []);
  return {
    skillNames: read,
    pluginNames: async () =>
      [...new Set((await read()).filter((name) => name.includes(':')).map((name) => name.split(':')[0]))].sort(),
    sessionOverrides: () => Promise.resolve({}),
    skillPlaces: CODEX_SKILL_PLACES,
  };
}
