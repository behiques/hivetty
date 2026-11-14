// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fillIncludes } from '../../../../electron/shared/skill-fragments';

const read = (path: string): string => readFileSync(join(process.cwd(), 'resources', path), 'utf8');
const ship = () => read('skills/ship/SKILL.md');
const mergePr = () => read('skills/merge-pr/SKILL.md');
const agent = (name: string) => read(`agents/${name}/AGENT.md`);
const words = (text: string) => text.replace(/^---[\s\S]*?\n---\n/, '').split(/\s+/).filter(Boolean).length;

describe('shipped text agrees (HIVE-413)', () => {
  it('ship is short enough to follow', () => {
    expect(words(ship())).toBeLessThanOrEqual(1300);
  });
  it('carries closes-ticket in the intake, the row and the Done rule', () => {
    expect(fillIncludes(ship())).toMatch(/closes-ticket: yes \| no/);
    expect(ship()).toMatch(/"closesTicket": true/);
    expect(mergePr()).toMatch(/closes-ticket: no/);
    expect(fillIncludes(agent('builder'))).toMatch(/closes-ticket/);
    expect(agent('shipper')).toMatch(/closes-ticket|closesTicket/);
  });
  it('claims before it accepts, in both shipper files', () => {
    for (const text of [ship(), agent('shipper')]) {
      expect(text.indexOf('ledger_claim')).toBeGreaterThan(-1);
      expect(text.indexOf('ledger_claim')).toBeLessThan(text.indexOf('ledger_accept'));
    }
  });
  it('step 0 loads the skills, and a handoff is state', () => {
    expect(agent('shipper')).toMatch(/A handoff is state, never procedure/);
  });
  it('reads only the fixer answer meta it defines', () => {
    expect(ship()).toMatch(/result: "clean" \| "blocked" \| "blocked-on"/);
    expect(agent('fixer')).toMatch(/result: "clean" \| "blocked" \| "blocked-on"/);
  });
  it('a missing prs.json is no rows', () => {
    expect(ship()).toMatch(/missing `prs\.json` is no rows/);
  });
  it('merge-pr re-reads UNKNOWN in the wake, and ship allows only that', () => {
    expect(mergePr()).toMatch(/UNKNOWN[^\n]*about 10 s, up to six times/);
    expect(ship()).not.toMatch(/Nothing here sleeps inside a turn\./);
  });
  it('the shipper resolves conflicts in both files', () => {
    expect(agent('shipper')).toMatch(/\bEdit\b/);
    expect(mergePr()).not.toMatch(/conflict is the fixer's/);
  });
  it('the blocked claim rule agrees between the fixer and its skill', () => {
    const rule = /`blocked`: answer, keep the claim/;
    expect(agent('fixer')).toMatch(rule);
    expect(read('skills/review-pr-findings/SKILL.md')).toMatch(rule);
  });
  it('ship and merge-pr name jira-tracker, not jira-writer', () => {
    expect(ship() + mergePr()).not.toMatch(/jira-writer/);
  });
  it('no stale shell claims in the shipper', () => {
    expect(agent('shipper')).not.toMatch(/a shell this fence does not give you|beyond the fallback above/);
  });
});

describe('the builder and the skills it loads agree (HIVE-414)', () => {
  const builder = () => agent('builder');
  const execute = () => read('skills/execute/SKILL.md');
  it('name one progress file, ignored where it is written', () => {
    for (const text of [builder(), execute()]) expect(text).toContain('<worktree>/.hive/sdd/<plan>/progress.md');
    expect(execute()).toMatch(/<worktree>\/\.hive\/\.gitignore/);
  });
  it('the shots folder is the one path outside the worktree the builder writes', () => {
    expect(builder()).toContain('<hive>/work/builder/shots/<ticket>/');
  });
  it('one gate, no caffeinate, closes-ticket falls back to the plan header', () => {
    expect(builder()).toMatch(/do\s+not run it a second time/);
    expect(builder()).not.toMatch(/caffeinate/);
    expect(builder()).toMatch(/`Closes ticket:`/);
  });
});

describe('one copy of each shared rule (HIVE-413 PR 2)', () => {
  const uses = (text: string, name: string) => text.includes(`{{include:${name}}}`);
  it('ship and the builder include the intake; neither restates it', () => {
    for (const text of [ship(), agent('builder')]) {
      expect(uses(text, 'ship-intake')).toBe(true);
      expect(text).not.toMatch(/key-confirmed: yes \| no/);
    }
  });
  it('the fixer and ship include the agent worktree recipe', () => {
    expect(uses(agent('fixer'), 'agent-worktree')).toBe(true);
    expect(uses(ship(), 'agent-worktree')).toBe(true);
  });
  it('ship, merge-pr and review-pr-findings include literal-target', () => {
    for (const text of [ship(), mergePr(), read('skills/review-pr-findings/SKILL.md')]) expect(uses(text, 'literal-target')).toBe(true);
  });
  it('tdd and execute share the tdd-loop, and tdd restates no loop of its own (HIVE-414)', () => {
    const tdd = read('skills/tdd/SKILL.md');
    const execute = read('skills/execute/SKILL.md');
    expect(uses(tdd, 'tdd-loop')).toBe(true);
    expect(uses(execute, 'tdd-loop')).toBe(true);
    for (const text of [tdd, execute]) expect(text).not.toContain('NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST');
  });
});

describe('the session skills (HIVE-415)', () => {
  const workOn = () => read('skills/work-on/SKILL.md');
  it('work-on names jira-tracker, stops only when a decision is needed, and has no timer', () => {
    expect(workOn()).not.toMatch(/jira-writer|Two stops|30 minutes/);
    expect(workOn()).toMatch(/jira-tracker/);
    expect(workOn()).toMatch(/only when the reconciliation needs a decision/);
  });
  it('work-on answers operational builder questions and reports failed, blocked and refused', () => {
    expect(workOn()).toMatch(/An operational question \(a missing service, a tool, a path, which gate runs where\) is yours/);
    expect(workOn()).toMatch(/`failed:` or `blocked:`/);
    expect(workOn()).toMatch(/never re-post the ask unchanged/);
    expect(workOn()).toMatch(/meta\.refused/);
  });
  it('work-on build ask carries absolute paths and every new field', () => {
    for (const field of ['base:', 'pr-title:', 'verify:', 'env:', 'part:', 'closes-ticket:', 'overlaps:'])
      expect(workOn()).toContain(`    ${field}`);
    expect(workOn()).toMatch(/plan: \/abs\/path\/to\/checkout\/\.hive\/plans\//);
    expect(workOn()).toMatch(/gh pr list --state open/);
  });
  it('work-on includes the intake, checks before it asks, and keeps a state file', () => {
    expect(workOn()).toContain('{{include:ship-intake}}');
    expect(workOn()).not.toMatch(/see\s+`ship`\s+for the intake/);
    expect(workOn()).toMatch(/\.hive\/plans\/<slug>\.state\.md/);
    expect(workOn()).toMatch(/Load \{\{skill:verify\}\} now \(in Claude Code, call the Skill tool\); do not run the gate from memory\./);
    expect(workOn()).toMatch(/UI not driven/);
    expect(workOn()).toMatch(/is written to that ticket as an UPDATED SPECS comment in the same\s+turn, before planning/);
    const steps = workOn().slice(workOn().indexOf('**5. Dispatch.**'));
    expect(steps.indexOf('{{tool:projects}}')).toBeLessThan(steps.indexOf('ledger_ask\n  to: builder'));
  });
  const goalOn = () => read('skills/goal-on/SKILL.md');
  it('goal-on always uses a worktree and includes the intake', () => {
    expect(goalOn()).not.toMatch(/workspace: current|workspace:|intake shape from/);
    expect(goalOn()).toContain('{{include:ship-intake}}');
    expect(goalOn()).toMatch(/invoke \{\{skill:verify\}\} \(the Skill tool\)/);
  });
  it('goal-on resumes from the brief, keeps gates in the foreground and edits the brief with Edit', () => {
    const one = (text: string) => text.replace(/\s+/g, ' ');
    expect(one(goalOn())).toContain(
      "Any turn that starts without this skill's text above it (a compaction, a resume): read the brief, then continue from the first unticked Outcome item.",
    );
    expect(one(goalOn())).toContain('Run the gates in the foreground. Never end a turn while a gate is running in the background: the hook will block and spend a turn.');
    expect(one(goalOn())).toContain('Edit the brief with `Edit`, never `Write`: the verifier stamps it between your turns.');
    expect(one(goalOn())).toContain('A reply that changes the brief is not approval. Amend, present the change, wait.');
    expect(one(goalOn())).toContain('One goal per session. When the shipper has the PR, run `/done`. A follow-up is a new session.');
  });
  const brainstorm = () => read('skills/brainstorm/SKILL.md').replace(/\s+/g, ' ');
  it('brainstorm reviews a bounded risk-surface change, mocks inside the shell and builds the sibling first', () => {
    expect(brainstorm()).toMatch(/If the change touches a risk surface \(the `\{\{skill:plan\}\}` list: auth, a credential, a token, a wire format, concurrency, money, a security predicate\), dispatch one task-reviewer/);
    expect(brainstorm()).toMatch(/inside the existing shell, at real widths and with real values/);
    expect(brainstorm()).toMatch(/the recommended option is "build the sibling first"/);
    expect(brainstorm()).toMatch(/No question in a batch depends on another question in the same batch/);
    expect(brainstorm()).toContain('{{skill:tdd}}');
  });
  it('spec-deviation writes through jira-tracker, session only, with one confirmation', () => {
    const text = read('skills/spec-deviation/SKILL.md');
    expect(text.replace(/\s+/g, ' ')).toMatch(/With HiveTTY's Jira tools loaded, never probe for the retired Jira writer skill\./);
    expect(text).not.toMatch(/jira-writer/);
    expect(text).toMatch(/jira-tracker/);
    expect(text.replace(/\s+/g, ' ')).toMatch(/Session only, never an agent\./);
    expect(text.replace(/\s+/g, ' ')).toMatch(/One confirmation covers the ticket and its downstream edits together/);
  });
  it('worktree puts an agent tree under its own working directory and installs from the lockfile', () => {
    const text = read('skills/worktree/SKILL.md');
    const one = text.replace(/\s+/g, ' ');
    expect(text).not.toMatch(/\.hivetty\/work/);
    expect(one).toMatch(/hivetty: `pnpm install --frozen-lockfile --offline`/);
    expect(one).toMatch(/never a `node_modules` symlink, which leaves the tree dirty and the shipper will not merge/);
    expect(one).toMatch(/run each `git` command alone, not chained with `&&` or `;`: the isolation guard refuses compound commands/);
  });
});
