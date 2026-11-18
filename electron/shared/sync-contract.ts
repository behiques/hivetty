/**
 * Settings sync (HIVE-284): what both processes share. The three switches; `workspace` is the ticket's name
 * for the third group, shown as "Appearance & preferences".
 */
export const SYNC_GROUPS = ['harnesses', 'automation', 'workspace'] as const;
export type SyncGroup = (typeof SYNC_GROUPS)[number];
export const SYNC_GROUP_LABELS: Record<SyncGroup, string> = {
  harnesses: 'Harnesses',
  automation: 'Automation',
  workspace: 'Appearance & preferences',
};

/** The fields of `hive.appearance` that sync. Panel widths, split ratios and every other field stay on the Mac. */
export const SYNCED_APPEARANCE_FIELDS = [
  'theme',
  'themes',
  'activeThemeId',
  'density',
  'terminalFont',
  'terminalFontSize',
  'editorFont',
  'editorFontSize',
  'editorWordWrap',
  'editorLineNumbers',
  'editorTabWidth',
] as const;
export type SyncedAppearanceField = (typeof SYNCED_APPEARANCE_FIELDS)[number];
export type SyncedAppearance = Partial<Record<SyncedAppearanceField, unknown>>;

/** A passphrase is at least this long when it is created; a short one is the scheme's only weak point. */
export const MIN_PASSPHRASE = 12;
export const WRONG_PASSPHRASE = "That passphrase doesn't open this account's sync.";
export const RESET_ELSEWHERE = 'Sync was reset on another Mac. Enter the new passphrase to sync again.';
export const NO_ENCRYPTION = "This Mac can't store the sync key securely, so sync is off.";

export type SyncProblem = 'offline' | 'busy' | 'too-large' | 'apply-failed';
export const SYNC_PROBLEM_COPY: Record<SyncProblem, string> = {
  offline: "Can't reach HiveTTY",
  busy: 'Sync is busy, retrying.',
  'too-large': 'Your synced setup is over 5 MB. Remove large files from your skills to sync again.',
  'apply-failed': "Some synced settings couldn't be applied here",
};

export type SyncStatus =
  | { kind: 'unavailable'; reason: 'signed-out' | 'no-encryption' | 'locked' }
  | { kind: 'off'; cloud: 'none' | 'present' | 'unknown'; resetElsewhere: boolean }
  | {
      kind: 'on';
      lastSyncedAt: number | null;
      groups: Record<SyncGroup, boolean>;
      conflicts: { count: number; latest: { path: string; at: number } | null };
      problem: SyncProblem | null;
    };

export type SyncSetupResult = { ok: true } | { ok: false; error: string };

export interface SetSyncGroupRequest {
  group: SyncGroup;
  on: boolean;
}

/** `sync:set-group`'s input, checked at the boundary: exactly `{ group, on }`. */
export function parseSetSyncGroupRequest(input: unknown): SetSyncGroupRequest {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('sync:set-group: expected { group, on }');
  }
  const raw = input as Record<string, unknown>;
  if (
    Object.keys(raw).length !== 2 ||
    !(SYNC_GROUPS as readonly unknown[]).includes(raw.group) ||
    typeof raw.on !== 'boolean'
  ) {
    throw new TypeError('sync:set-group: expected { group, on }');
  }
  return { group: raw.group as SyncGroup, on: raw.on };
}

/** Keeps only the listed appearance fields; anything else is dropped. */
export function parseSyncedAppearance(input: unknown): SyncedAppearance {
  if (typeof input !== 'object' || input === null) return {};
  const out: SyncedAppearance = {};
  for (const field of SYNCED_APPEARANCE_FIELDS) {
    if (Object.hasOwn(input, field)) out[field] = (input as Record<string, unknown>)[field];
  }
  return out;
}
