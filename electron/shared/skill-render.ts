import { CAPABILITIES, type HarnessId } from './harness-contract';

/**
 * HiveTTY's skills written once, read by any CLI (HIVE-369).
 *
 * A skill names hive tools, other skills and its own folder through placeholders, and this fills
 * them in from the CLI's `CAPABILITIES[cli].skills`. Pure, so the generator in main and the
 * Settings preview in the renderer render the same text.
 */

const PLACEHOLDER = /\{\{(?:(tool|skill):([a-z0-9_-]+)|plugin_root)\}\}/g;

/** `{{tool:x}}`, `{{skill:x}}` and `{{plugin_root}}` filled for `cli`; any other text untouched. */
export function fillPlaceholders(text: string, cli: HarnessId): string {
  const names = CAPABILITIES[cli].skills;
  return text.replace(PLACEHOLDER, (_match, kind: string | undefined, name: string | undefined) => {
    if (kind === 'tool') return `${names.toolPrefix}${name ?? ''}`;
    if (kind === 'skill') return `${names.refPrefix}${name ?? ''}`;
    return names.pluginRoot;
  });
}

/**
 * What a session on `cli` types to run `skill`, stored as Claude names it (`hive:work-on`).
 * Claude keeps the plugin's namespace; the others load HiveTTY's skills by their bare name.
 */
export function typedSkill(skill: string, cli: HarnessId): string {
  if (cli === 'claude-code') return `/${skill}`;
  return `${CAPABILITIES[cli].skills.typedPrefix}${skill.replace(/^hive:/, '')}`;
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

/** One skill file as `cli` receives it: Claude-only keys dropped, placeholders filled. */
export function renderSkillText(text: string, cli: HarnessId): string {
  return fillPlaceholders(dropFrontmatterKeys(text, dropKeysFor(cli)), cli);
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
    pattern: /\/?hive:([a-z0-9-]+)/g,
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
