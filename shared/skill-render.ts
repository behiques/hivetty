import { CAPABILITIES, type HarnessId } from './harness-contract';
import { FRAGMENTS, fillIncludes, INCLUDE } from './skill-fragments';

/**
 * HiveTTY's skills written once, read by any CLI (HIVE-369).
 *
 * A skill names hive tools, other skills and its own folder through placeholders, and this fills
 * them in from the CLI's `CAPABILITIES[cli].skills`. Pure, so the generator in main and the
 * Settings preview in the renderer render the same text.
 */

const PLACEHOLDER = /\{\{(?:(tool|skill):([a-z0-9_-]+)|plugin_root)\}\}/g;

/**
 * `{{tool:x}}`, `{{skill:x}}` and `{{plugin_root}}` filled for `cli`; any other text untouched.
 * Claude Code sets `$CLAUDE_PLUGIN_ROOT`; no variable names Codex's or Copilot's folder, so their
 * `{{plugin_root}}` becomes `root`, the folder being rendered, and stays as written without one.
 */
export function fillPlaceholders(text: string, cli: HarnessId, root?: string): string {
  const names = CAPABILITIES[cli].skills;
  return text.replace(PLACEHOLDER, (match, kind: string | undefined, name: string | undefined) => {
    if (kind === 'tool') return `${names.toolPrefix}${name ?? ''}`;
    if (kind === 'skill') return `${names.refPrefix}${name ?? ''}`;
    return names.pluginRoot ?? root ?? match;
  });
}

/**
 * What a session on `cli` types to run `skill`, stored as Claude names it (`hive:work-on`).
 * Claude keeps the plugin's namespace, Copilot types `/hive:hive-<name>` (HIVE-382) and Codex loads
 * `$hive-<name>` (HIVE-384). A skill outside hive keeps only the CLI's sigil.
 */
export function typedSkill(skill: string, cli: HarnessId): string {
  if (cli === 'claude-code') return `/${skill}`;
  const { typedPrefix } = CAPABILITIES[cli].skills;
  if (skill.startsWith('hive:')) return `${typedPrefix}${skill.slice('hive:'.length)}`;
  return `${typedPrefix.charAt(0)}${skill}`;
}

/** Frontmatter keys `cli` must not read: Claude Code's own hook and tool grants. */
export function dropKeysFor(cli: HarnessId): readonly string[] {
  return cli === 'claude-code' ? [] : ['hooks', 'allowed-tools'];
}

/**
 * Drop `keys` from the frontmatter, each with every line up to the next unindented one, blank lines
 * included (a `prompt: |` block holds them). Text outside the fences and an unterminated header
 * are untouched.
 */
function dropFrontmatterKeys(text: string, keys: readonly string[]): string {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return text;
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close === -1) return text;

  const kept: string[] = [lines[0]];
  let dropping = false;
  for (const line of lines.slice(1, close)) {
    const topLevel = line !== '' && !/^\s/.test(line);
    if (topLevel) dropping = keys.some((key) => line.startsWith(`${key}:`));
    if (!dropping) kept.push(line);
  }
  return [...kept, ...lines.slice(close)].join('\n');
}

/** The frontmatter's top-level `name:` given `prefix`, its quotes dropped; anything else untouched. */
function prefixFrontmatterName(text: string, prefix: string): string {
  if (prefix === '') return text;
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return text;
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close === -1) return text;
  const at = lines.findIndex((line, index) => index < close && line.startsWith('name:'));
  if (at === -1) return text;
  const name = lines[at].slice('name:'.length).trim().replace(/^(["'])(.*)\1$/, '$2');
  lines[at] = `name: ${prefix}${name}`;
  return lines.join('\n');
}

/** One skill file as `cli` receives it: Claude-only keys dropped, includes expanded, its name prefixed, placeholders filled. */
export function renderSkillText(text: string, cli: HarnessId, root?: string): string {
  const kept = dropFrontmatterKeys(text, dropKeysFor(cli));
  return fillPlaceholders(prefixFrontmatterName(fillIncludes(kept), CAPABILITIES[cli].skills.namePrefix), cli, root);
}

/** HIVE-372: the plugin Codex installs also loads outside HiveTTY, where the hive tools and receiver are absent. */
export const SKILL_GUARD =
  'Before anything else, run `printenv HIVE_RECEIVER_URL`. If it prints nothing, tell the user "this skill needs a HiveTTY session" and stop.';

/** `text` with {@link SKILL_GUARD} as its first paragraph after the frontmatter. */
export function guardSkill(text: string): string {
  const lines = text.split('\n');
  const close = lines[0]?.trim() === '---' ? lines.findIndex((line, index) => index > 0 && line.trim() === '---') : -1;
  if (close === -1) return `${SKILL_GUARD}\n\n${text}`;
  return [...lines.slice(0, close + 1), '', SKILL_GUARD, '', ...lines.slice(close + 1)].join('\n');
}

/** The names a skill may point at: hive tools and skills, `done` included. */
export interface PortabilityKnown {
  tools: readonly string[];
  skills: readonly string[];
}

/** A CLI-specific literal, or a placeholder naming nothing, found in a skill file (HIVE-369). */
export interface PortabilityIssue {
  /** 1-based. */
  line: number;
  /** The text as written. */
  found: string;
  /** The placeholder to write instead, or `null` when the name itself is wrong. */
  fix: string | null;
  /** One sentence, shown as is. */
  message: string;
}

interface Rule {
  pattern: RegExp;
  /** The placeholder for the captured `name`, or `null` when this match is not this rule's business. */
  fix(name: string, known: PortabilityKnown): string | null;
  message(found: string, fix: string): string;
}

/*
  Only names that are certainly ours. A bare `/plan` or `$plan` in prose may be a path or a shell
  variable, and `hive-x` is another server's tool unless `x` is a hive tool, so neither is flagged.
*/
const RULES: readonly Rule[] = [
  {
    pattern: /mcp__hive__([a-z_]+)/g,
    fix: (name) => `{{tool:${name}}}`,
    message: (found, fix) => `\`${found}\` only works in Claude Code and Codex. Write \`${fix}\`.`,
  },
  {
    pattern: /\bhive-([a-z_]+)\b/g,
    fix: (name, known) => (known.tools.includes(name) ? `{{tool:${name}}}` : null),
    message: (found, fix) => `\`${found}\` only works in Copilot. Write \`${fix}\`.`,
  },
  {
    pattern: /(?<![\w-])hive:([a-z0-9-]+)/g,
    fix: (name, known) => (known.skills.includes(name) ? `{{skill:${name}}}` : null),
    message: (found, fix) => `\`${found}\` only works in Claude Code. Write \`${fix}\`.`,
  },
  {
    pattern: /\$CLAUDE_PLUGIN_ROOT()/g,
    fix: () => '{{plugin_root}}',
    message: (found, fix) => `\`${found}\` is only set in Claude Code. Write \`${fix}\`.`,
  },
];

const DANGLING = /\{\{(tool|skill):([a-z0-9_-]+)\}\}/g;

/** Every CLI-specific literal and dangling placeholder in `text`, in line order. */
export function portabilityIssues(text: string, known: PortabilityKnown): PortabilityIssue[] {
  return text.split('\n').flatMap((content, index) => {
    const line = index + 1;
    const found: { at: number; issue: PortabilityIssue }[] = [];
    for (const rule of RULES) {
      for (const match of content.matchAll(rule.pattern)) {
        const fix = rule.fix(match[1] ?? '', known);
        if (fix !== null) {
          found.push({ at: match.index, issue: { line, found: match[0], fix, message: rule.message(match[0], fix) } });
        }
      }
    }
    for (const match of content.matchAll(DANGLING)) {
      const [whole, kind, name = ''] = match;
      if (!(kind === 'tool' ? known.tools : known.skills).includes(name)) {
        const message = kind === 'tool' ? `No hive tool is called \`${name}\`.` : `No skill is called \`${name}\`.`;
        found.push({ at: match.index, issue: { line, found: whole, fix: null, message } });
      }
    }
    for (const match of content.matchAll(INCLUDE)) {
      const name = match[1] ?? '';
      if (FRAGMENTS[name] === undefined) {
        found.push({ at: match.index, issue: { line, found: match[0], fix: null, message: `No fragment is called \`${name}\`.` } });
      }
    }
    return found.sort((a, b) => a.at - b.at).map(({ issue }) => issue);
  });
}

/** `text` with every fixable literal rewritten to its placeholder; everything else untouched. */
export function makePortable(text: string, known: PortabilityKnown): string {
  return RULES.reduce(
    (out, rule) => out.replace(rule.pattern, (whole: string, name: string) => rule.fix(name, known) ?? whole),
    text,
  );
}
