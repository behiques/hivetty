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
