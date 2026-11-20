import { describe, expect, it } from 'vitest';

import { DONE_DESCRIPTION, doneToolSkill } from '../../../core/harness/done-tool-skill';

describe('doneToolSkill (HIVE-368)', () => {
  it('names the tool as Codex calls it, with no shell and no grant', () => {
    const text = doneToolSkill('codex');
    expect(text).toMatch(/^---\nname: hive-done\n/);
    expect(text).toContain('`mcp__hive__session_done`');
    expect(text).not.toContain('allowed-tools');
    expect(text).not.toContain('curl');
    expect(text).not.toContain('{{');
  });
  it('names the tool as Copilot calls it', () => {
    expect(doneToolSkill('copilot')).toContain('`hive-session_done`');
  });
  it('grants Claude the one tool, since Claude reads allowed-tools per skill', () => {
    const text = doneToolSkill('claude-code');
    expect(text).toMatch(/^---\nname: done\n/);
    expect(text).toContain('allowed-tools: mcp__hive__session_done\n---');
    expect(text).not.toContain('curl');
  });
  it('carries the description the catalog repeats', () => {
    expect(doneToolSkill('codex')).toContain(DONE_DESCRIPTION);
  });
});
