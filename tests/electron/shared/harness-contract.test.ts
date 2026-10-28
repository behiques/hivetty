// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CAPABILITIES, HARNESS_IDS, type HarnessId, isHarnessId } from '../../../electron/shared/harness-contract';

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

describe('CAPABILITIES: what a session on each CLI supports (HIVE-281)', () => {
  const shown = (id: HarnessId) => {
    const c = CAPABILITIES[id];
    return {
      hooks: c.hooks,
      permissionCards: c.permissionCards,
      plan: c.plan,
      skills: c.skills,
      markers: c.contextDelivery === 'prompt-marker',
    };
  };

  it('Claude Code supports all five', () => {
    expect(shown('claude-code')).toEqual({ hooks: true, permissionCards: true, plan: true, skills: true, markers: true });
  });

  it('Codex: no skills or prompt markers until HIVE-360', () => {
    expect(shown('codex')).toEqual({ hooks: true, permissionCards: true, plan: true, skills: false, markers: false });
  });

  it('Copilot: no plan (FINDINGS P4), skills or prompt markers', () => {
    expect(shown('copilot')).toEqual({ hooks: true, permissionCards: true, plan: false, skills: false, markers: false });
  });

  it('has a table for every CLI', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...HARNESS_IDS].sort());
  });
});
