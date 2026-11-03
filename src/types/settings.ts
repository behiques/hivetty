/**
 * The settings overlay's panes, as an id.
 *
 * Here rather than in `settings-overlay.tsx`, where the list itself lives,
 * because `ui-store` has to name one to honour `openSettings('agents')` — and
 * a store may not import a feature slice. The overlay derives its `GROUPS`
 * and `PANES` records from this union, so a pane added there without a member
 * here does not compile, and the two cannot drift.
 *
 * Stable, kebab-case and group-free (HIVE-374): a pane can change groups
 * without a caller noticing. The order and grouping live in
 * `settings-overlay.tsx`; this is the vocabulary, not the arrangement.
 */
export type SettingsSection =
  | 'harnesses-overview'
  | 'shell'
  | 'agents'
  | 'skills'
  | 'projects'
  | 'appearance'
  | 'editor'
  | 'integrations'
  | 'notifications'
  | 'advanced';

/**
 * Ids the grouped nav retired, and the pane that took each one's place.
 *
 * `openSettings` still takes them, so no caller breaks between the epic's PRs
 * (HIVE-373). `advanced` needs no entry: it is still a pane.
 */
export const LEGACY_SETTINGS_SECTIONS = {
  runtime: 'shell',
  clis: 'harnesses-overview',
} as const satisfies Record<string, SettingsSection>;

export type LegacySettingsSection = keyof typeof LEGACY_SETTINGS_SECTIONS;
