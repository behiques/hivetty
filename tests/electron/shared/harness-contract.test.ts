// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { HARNESS_IDS, isHarnessId } from '../../../electron/shared/harness-contract';

describe('isHarnessId (HIVE-340)', () => {
  it('accepts every id the app can drive', () => {
    for (const id of HARNESS_IDS) expect(isHarnessId(id)).toBe(true);
  });

  it('knows codex (HIVE-342)', () => {
    expect(isHarnessId('codex')).toBe(true);
  });

  it('knows copilot (HIVE-343)', () => {
    expect(isHarnessId('copilot')).toBe(true);
  });

  it('refuses a CLI with no adapter yet, and a near-miss spelling', () => {
    expect(isHarnessId('gemini')).toBe(false);
    expect(isHarnessId('claude')).toBe(false);
  });
});
