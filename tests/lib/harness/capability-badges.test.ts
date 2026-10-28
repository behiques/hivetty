import { describe, expect, it } from 'vitest';

import { capabilityBadges } from '@lib/harness/capability-badges';

describe('capabilityBadges (HIVE-281)', () => {
  it('lists the five in a fixed order', () => {
    expect(capabilityBadges('claude-code').map((b) => b.label)).toEqual([
      'Hooks',
      'Permission cards',
      'Plan',
      'Skills',
      'Prompt markers',
    ]);
  });

  it('marks what Codex lacks', () => {
    expect(capabilityBadges('codex').map((b) => b.supported)).toEqual([true, true, true, false, false]);
  });

  it('marks what Copilot lacks', () => {
    expect(capabilityBadges('copilot').map((b) => b.supported)).toEqual([true, true, false, false, false]);
  });
});
