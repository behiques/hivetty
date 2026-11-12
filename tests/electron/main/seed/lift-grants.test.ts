// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { liftGrants } from '../../../../electron/main/seed/lift-grants';

describe('liftGrants (HIVE-409)', () => {
  const agent = (lines: string) => `---\nname: shipper\n${lines}\n---\nBody\n`;

  it('moves rules beyond the shipped list into grants:, and tools: becomes the shipped list', () => {
    const out = liftGrants(agent('tools: [Read, Bash, Edit]'), agent('tools: [Read, Bash]'));
    expect(out).toContain('tools: [Read, Bash]\n');
    expect(out).toContain('grants: [Edit]');
  });

  it('drops a scoped rule a bare shipped tool already covers', () => {
    const out = liftGrants(
      agent('tools: [Read, Write, Skill, Bash(gh pr view *), Bash(git -C * fetch *), Bash, mcp__hive__jira_transition]'),
      agent('tools: [Read, Write, Skill, Bash, mcp__hive__jira_transition]'),
    );
    expect(out).toContain('tools: [Read, Write, Skill, Bash, mcp__hive__jira_transition]\n');
    expect(out).toContain('grants: []');
  });

  it('keeps a bare tool the shipped list lacks, and the scoped rules it covers go', () => {
    const out = liftGrants(agent('tools: [Read, Bash(git *), Bash]'), agent('tools: [Read]'));
    expect(out).toContain('tools: [Read]\n');
    expect(out).toContain('grants: [Bash]');
  });

  it('a tools: the person narrowed is left alone, and marked done', () => {
    const out = liftGrants(agent('tools: [Read]'), agent('tools: [Read, Bash]'));
    expect(out).toContain('tools: [Read]\n');
    expect(out).toContain('grants: []');
  });

  it('a file that already has grants: is untouched', () => {
    const current = agent('tools: [Read, Bash, Edit]\ngrants: []');
    expect(liftGrants(current, agent('tools: [Read, Bash]'))).toBe(current);
  });

  it('a file whose tools: equals the shipped list is untouched', () => {
    const current = agent('tools: [Read, Bash]');
    expect(liftGrants(current, agent('tools: [Read, Bash]'))).toBe(current);
  });

  it('a list that does not parse, on either side, leaves the file alone', () => {
    const current = agent('tools: Read, Bash');
    expect(liftGrants(current, agent('tools: [Read]'))).toBe(current);
    const mine = agent('tools: [Read, Edit]');
    expect(liftGrants(mine, agent('tools: Read'))).toBe(mine);
  });

  it('an entry that cannot be written back safely leaves the file alone', () => {
    // parseList strips one pair of quotes: "'*'" would be written back as '*', which reads as *.
    for (const bad of ['"\'*\'"', '" *"', 'a]b']) {
      const current = agent(`tools: [Read, ${bad}]`);
      expect(liftGrants(current, agent('tools: [Read]'))).toBe(current);
    }
  });

  it('a file without frontmatter is untouched', () => {
    expect(liftGrants('no fence\n', agent('tools: [Read]'))).toBe('no fence\n');
  });

  it('what the wake allows never shrinks', () => {
    const before = agent('tools: [Read, Bash(git *), Edit, WebFetch(domain:x.com)]');
    const out = liftGrants(before, agent('tools: [Read, Grep]'));
    for (const rule of ['Read', 'Bash(git *)', 'Edit', 'WebFetch(domain:x.com)']) expect(out).toContain(rule);
  });

  it('a lift keeps every rule it moves, in order', () => {
    const out = liftGrants(agent('tools: [Read, Bash(git *), Edit, WebFetch(domain:x.com)]'), agent('tools: [Read]'));
    expect(out).toContain('tools: [Read]\n');
    expect(out).toContain('grants: [Bash(git *), Edit, WebFetch(domain:x.com)]');
  });
});
