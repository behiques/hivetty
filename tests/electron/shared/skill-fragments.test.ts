import { describe, expect, it } from 'vitest';

import { FRAGMENTS, fillIncludes } from '../../../electron/shared/skill-fragments';

describe('skill fragments (HIVE-413)', () => {
  it('ships the three shared rules', () => {
    expect(Object.keys(FRAGMENTS).sort()).toEqual(['agent-worktree', 'literal-target', 'ship-intake']);
  });
  it('hold no placeholder, so skills and agent prompts read the same text', () => {
    for (const [name, text] of Object.entries(FRAGMENTS)) expect(text, name).not.toMatch(/\{\{/);
  });
  it('expands a known include, one level', () => {
    expect(fillIncludes('a\n{{include:ship-intake}}\nb')).toBe(`a\n${FRAGMENTS['ship-intake']}\nb`);
  });
  it('leaves an unknown include as written', () => {
    expect(fillIncludes('{{include:nope}}')).toBe('{{include:nope}}');
  });
});
