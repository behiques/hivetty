import {
  LINE_KILL_SEQUENCE,
  LINE_MOTION_SEQUENCE,
  NEWLINE_SEQUENCE,
  claimBareBack,
  type BareBackClaim,
  type CursorContext,
} from '@lib/terminal/keymap';
import type { HarnessId } from '@shared/harness-contract';

/**
 * How the renderer talks to a harness's TUI (HIVE-240): the bytes three chords type, and whether
 * a bare ← at an empty prompt is the app's. The main-process half is the adapter; this is the
 * renderer's, because keys never cross the process boundary.
 */
export interface InputProfile {
  /** What Shift+Enter types: a line break that does not submit. See `NEWLINE_SEQUENCE`. */
  newline: string;
  /** What Cmd+Delete types. See `LINE_KILL_SEQUENCE`. */
  lineKill: string;
  /** What Cmd+← and Cmd+→ type. See `LINE_MOTION_SEQUENCE`. */
  lineMotion: Readonly<Record<'line-start' | 'line-end', string>>;
  /** Whether a bare ← at this caret belongs to the app. See `claimBareBack`. */
  claimsBareBack(cursor: CursorContext): BareBackClaim;
}

/** Today's keys, verified against Claude Code's binary: every surface with no harness gets them too. */
export const DEFAULT_INPUT_PROFILE: InputProfile = {
  newline: NEWLINE_SEQUENCE,
  lineKill: LINE_KILL_SEQUENCE,
  lineMotion: LINE_MOTION_SEQUENCE,
  claimsBareBack: claimBareBack,
};

/** Keyed by every `HarnessId`, so a harness without a profile fails to compile. */
const PROFILES: Record<HarnessId, InputProfile> = {
  'claude-code': DEFAULT_INPUT_PROFILE,
  // Ctrl+J, measured at 0.164 (HIVE-279; tests/fixtures/codex/interactive-0.164/FINDINGS.md P7).
  codex: { ...DEFAULT_INPUT_PROFILE, newline: '\n' },
  // Alt+Enter (ESC CR), measured at 1.0.105 (HIVE-280; tests/fixtures/copilot/interactive-1.0.105/FINDINGS.md P6).
  copilot: { ...DEFAULT_INPUT_PROFILE, newline: '\x1b\r' },
};

/** The profile for an entity's harness; `undefined` (a terminal, a command, the console) is the default. */
export const inputProfileFor = (harness: HarnessId | undefined): InputProfile =>
  harness === undefined ? DEFAULT_INPUT_PROFILE : PROFILES[harness];
