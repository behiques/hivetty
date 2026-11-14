import { describe, expect, it } from 'vitest';

import { FRAGMENTS, fillIncludes } from '../../../electron/shared/skill-fragments';

describe('skill fragments (HIVE-413)', () => {
  it('ships the four shared rules', () => {
    expect(Object.keys(FRAGMENTS).sort()).toEqual(['agent-worktree', 'literal-target', 'ship-intake', 'tdd-loop']);
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

  it('tdd-loop carries the law, the loop, the red flags and the three HIVE-414 additions', () => {
    const loop = FRAGMENTS['tdd-loop'];
    expect(loop).toContain('NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST');
    expect(loop).toMatch(/\*\*RED\.\*\*[\s\S]*\*\*GREEN\.\*\*[\s\S]*\*\*REFACTOR\.\*\*/);
    expect(loop).toContain('| Thought | Reality |');
    expect(loop).toContain('An injectable seam gets one test that runs the real default.');
    expect(loop).toContain('State keyed by an id gets a switch-the-id test and a failed-call test.');
    expect(loop).toContain('A predicate that refuses commands gets a table test from the evasion list:');
    expect(loop).toContain('every refspec spelling, every API spelling of the same act.');
    expect(fillIncludes('{{include:tdd-loop}}')).toBe(loop);
  });
});
