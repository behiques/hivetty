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
