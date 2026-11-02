import { CAPABILITIES, type HarnessId, SKILL_FEATURES, type SkillFeature } from './harness-contract';

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

/** Frontmatter keys `cli` must not read. `requires:` is HiveTTY's own and never leaves the source. */
export function dropKeysFor(cli: HarnessId): readonly string[] {
  return cli === 'claude-code' ? ['requires'] : ['requires', 'hooks', 'allowed-tools'];
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

/** A `requires:` value (`[a, b]`, `a, b`, `a`, or absent) read into features, or why it cannot be. */
export function parseRequires(raw: string | undefined): SkillFeature[] | string {
  const names = (raw ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  const unknown = names.find((name) => !(SKILL_FEATURES as readonly string[]).includes(name));
  if (unknown !== undefined) return `requires: "${unknown}" is not one of ${SKILL_FEATURES.join(', ')}.`;
  return names as SkillFeature[];
}

/** The features a skill requires that `cli` lacks; empty when the skill loads there. */
export function missingFeatures(requires: readonly SkillFeature[], cli: HarnessId): SkillFeature[] {
  return requires.filter((feature) => !CAPABILITIES[cli].skills.features.includes(feature));
}
