import { describe, expect, it } from 'vitest';

import { DEFAULT_INPUT_PROFILE, inputProfileFor } from '@lib/harness/input-profile';
import {
  LINE_KILL_SEQUENCE,
  LINE_MOTION_SEQUENCE,
  NEWLINE_SEQUENCE,
  claimBareBack,
} from '@lib/terminal/keymap';

describe('input profiles (HIVE-240)', () => {
  it('makes the default profile exactly the keys the terminal has always sent', () => {
    expect(DEFAULT_INPUT_PROFILE.newline).toBe(NEWLINE_SEQUENCE);
    expect(DEFAULT_INPUT_PROFILE.lineKill).toBe(LINE_KILL_SEQUENCE);
    expect(DEFAULT_INPUT_PROFILE.lineMotion).toBe(LINE_MOTION_SEQUENCE);
    expect(DEFAULT_INPUT_PROFILE.claimsBareBack).toBe(claimBareBack);
  });

  it('gives Claude Code the default, and the default to anything no harness drives', () => {
    expect(inputProfileFor('claude-code')).toBe(DEFAULT_INPUT_PROFILE);
    expect(inputProfileFor(undefined)).toBe(DEFAULT_INPUT_PROFILE);
  });

  it('gives Codex its Ctrl+J newline and the default for the rest (HIVE-279, FINDINGS P7)', () => {
    const codex = inputProfileFor('codex');
    expect(codex.newline).toBe('\n');
    expect(codex.lineKill).toBe(DEFAULT_INPUT_PROFILE.lineKill);
    expect(codex.lineMotion).toBe(DEFAULT_INPUT_PROFILE.lineMotion);
    expect(codex.claimsBareBack).toBe(DEFAULT_INPUT_PROFILE.claimsBareBack);
  });

  it('gives Copilot its Alt+Enter newline and the default for the rest (HIVE-280, FINDINGS P6)', () => {
    const copilot = inputProfileFor('copilot');
    expect(copilot.newline).toBe('\x1b\r');
    expect(copilot.lineKill).toBe(DEFAULT_INPUT_PROFILE.lineKill);
    expect(copilot.claimsBareBack).toBe(DEFAULT_INPUT_PROFILE.claimsBareBack);
  });
});
