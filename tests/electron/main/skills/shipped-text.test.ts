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
    // HIVE-416: the limit is on the stage table plus its numbered steps (about 1,200 words);
    // the whole file is held under 1,450 so the prose around them cannot grow unseen
    // (raised from 1,400 for the CI bound and the Drive trigger's test-file rule; the steps limit is the real one).
    const body = ship().replace(/^---[\s\S]*?\n---\n/, '');
    const steps = body.slice(body.indexOf('| Stage |'), body.indexOf('## A stuck row'));
    expect(words(steps)).toBeLessThanOrEqual(1200);
    expect(words(ship())).toBeLessThanOrEqual(1450);
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
    expect(workOn()).toMatch(/Load \{\{skill:verify\}\} now \(in Claude Code, call the Skill tool\); do not run\s+the gate from memory\./);
    expect(workOn()).toMatch(/UI not driven/);
    expect(workOn()).toMatch(/is written to that ticket as an UPDATED SPECS comment in the same\s+turn, before planning/);
    const steps = workOn().slice(workOn().indexOf('**5. Dispatch.**'));
    expect(steps.indexOf('{{tool:projects}}')).toBeLessThan(steps.indexOf('ledger_ask\n  to: builder'));
  });
  const goalOn = () => read('skills/goal-on/SKILL.md');
  it('goal-on always uses a worktree and includes the intake', () => {
    expect(goalOn()).not.toMatch(/workspace: current|workspace:|intake shape from/);
    expect(goalOn()).toContain('{{include:ship-intake}}');
    expect(goalOn()).toMatch(/invoke \{\{skill:verify\}\} \(in Claude Code, the Skill tool\)/);
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
  it('the builder reads every field work-on writes into the build ask', () => {
    const builder = agent('builder');
    const parse = builder.slice(builder.indexOf('1. `ledger_read`'), builder.indexOf('2. `ledger_claim'));
    for (const field of ['base', 'pr-title', 'verify', 'env', 'part', 'overlaps', 'closes-ticket'])
      expect(parse).toContain(`\`${field}\``);
    expect(builder.replace(/\s+/g, ' ')).toMatch(/`after #N` reads as origin\/<default>/);
    expect(builder.replace(/\s+/g, ' ')).toMatch(/`pr-title` when the ask gives one/);
  });
});

describe('the review path (HIVE-416)', () => {
  const one = (text: string) => text.replace(/\s+/g, ' ');
  const scorer = () => read('skills/pr-review/prompts/confidence-scorer.md');
  it('the verifier returns confidence and severity, never one score', () => {
    expect(scorer()).not.toMatch(/"score"/);
    expect(scorer()).toMatch(/"confidence": <number 0-100>, "severity": "block" \| "should_fix" \| "minor"/);
    expect(one(scorer())).toContain(
      'A reproduced bypass of a security, licence or consent check is block however obscure the input.',
    );
    expect(one(scorer())).toContain('How often it happens belongs here, never in confidence.');
    expect(one(scorer())).toMatch(/75 or above only when you read the source and can name the input, state or timing that triggers it/);
  });
  const prReview = () => read('skills/pr-review/SKILL.md');
  it('pr-review keeps verified minor findings and has one borderline band', () => {
    expect(prReview()).not.toMatch(/60–79|60-79|always the full tier|keep editing|`command -v acr` succeeds \| ACR \|/);
    expect(one(prReview())).toContain(
      'Drop anything with confidence below 60. Confidence 60-74 is borderline. Confidence 75 or above is a finding at the verifier\'s severity; in self mode `minor` findings come back in their own list, "verified, minor", and are never dropped. Self mode has no reader to tire: the caller is a fixer.',
    );
    expect(prReview()).toMatch(/"verified_minor": 0/);
    expect(prReview()).toMatch(/"tier": "docs" \| "small" \| "full" \| "deep"/);
    expect(prReview()).toMatch(/"context": \{ "spec":/);
    expect(prReview()).toMatch(/`ACR_CLI`/);
  });
  it('pr-review tiers self mode too, with a deep tier for size and risk', () => {
    const text = one(prReview());
    expect(text).toMatch(/\*\*The tier\*\*, in both modes/);
    expect(text).toMatch(/\*\*deep\*\* when `RISK`, or `LINES` over 1,000/);
    expect(text).toMatch(/auth, token, credential, secret, permission, licen\[cs\]e, payment/);
    expect(text).toMatch(/one per top-level directory in `DIRS`, at most 4/);
  });
  it('pr-review reviews the PR head for --self <pr> and takes SPEC, PLAN and NOTES', () => {
    const text = one(prReview());
    expect(text).toMatch(/`--self <pr>` reviews the PR head/);
    expect(text).toMatch(/never fall back to a working tree/);
    expect(text).toContain('`SPEC=<abs path> PLAN=<abs path> NOTES=<abs path>`');
    expect(text).toContain('the last thing the skill writes');
    expect(text).toMatch(/The bug scan and its per-directory scans are one reviewer here and in step 5/);
    expect(text).toMatch(/When `DIRS` has one group the slice is the whole diff: dispatch no per-directory scan/);
    expect(text).toMatch(/In self mode the outcome is `findings` when any finding, verified-minor or borderline item survives/);
    for (const name of ['bug-scan', 'business-alignment', 'user-pov', 'state-lifecycle'])
      expect(read(`skills/pr-review/prompts/agent-${name}.md`)).toMatch(/`SPEC`, `PLAN`, `NOTES`/);
  });
  it('pr-review puts borderline and verified-minor findings through steps 3 and 4 like every finding', () => {
    const text = one(prReview());
    expect(text).toContain('Borderline and verified-minor findings go through steps 3 and 4 like every finding.');
    expect(text).toContain('Being small is never the reason a verified-minor is dropped: that is what its list is for.');
    expect(text).not.toMatch(/dropped there only when it lacks an exact file/);
  });
  it('prefetch-ticket reads through the jira-tracker script, and no skill names jira-writer', () => {
    const prefetch = read('skills/pr-review/prompts/prefetch-ticket.md');
    expect(prefetch).toContain('bash "$JT" get_issue <KEY>');
    expect(prefetch).toContain('JT="$SKILL_DIR/../jira-tracker/scripts/jira-api-wrapper.sh"');
    expect(prReview()).toMatch(/Ticket alignment also gets `SKILL_DIR=<this skill's base directory>`/);
    expect(prefetch).toMatch(/"route": "atlassian-mcp" \| "jira-tracker" \| "hive"/);
    expect(prefetch).not.toMatch(/jira-writer/);
  });
  it('acr reports borderline and verified_minor in meta and passes the context through', () => {
    const acr = agent('acr');
    expect(acr).toContain('borderline: <counts.borderline>');
    expect(acr).toContain('verified_minor: <counts.verified_minor>');
    expect(acr).toMatch(/--self <pr url> \[SPEC=<path>\] \[PLAN=<path>\] \[NOTES=<path>\] REPO=<path>/);
    expect(one(acr)).not.toMatch(/looks through the project's worktrees|reviews your work on the branch/);
  });
  it('ship passes the context to acr, branches on its meta, and gates fixer heads once', () => {
    const text = one(ship());
    expect(text).toContain('`<pr url> --self`, then `SPEC=<spec> PLAN=<plan> NOTES=<notes>`, each only when the row holds a path');
    expect(text).toMatch(/Read acr's `meta`, never the body/);
    expect(text).toMatch(/`findings \+ borderline \+ verified_minor` above 0 → `fix-self`; all 0 → `ready`/);
    expect(text).toContain('the fixer takes a verified-minor when the fix is under about 20 lines and answers the rest');
    expect(text).toMatch(/findings, borderline and verified-minor all go to the fixer in one ask/i);
    expect(text).toMatch(/"spec": null, "plan": null, "notes": null/);
    expect(text).toMatch(/`gatedHead`/);
    expect(text).toMatch(/confidence 60-74/);
  });
  it('ship reads CI per PR, with the fixer stand-in only where no workflow runs on pull_request', () => {
    const text = one(ship());
    expect(text).not.toMatch(/prCi|decided at the lane's first `ci` stage|Remove this step once HIVE-417/);
    expect(text).toContain('Read per PR, at every `ci` stage');
    expect(text).toContain('Checks reported → wait for them; exit 8 is pending, and a required check that is pending is not green');
    expect(text).toContain('No checks reported and no workflow triggered on `pull_request` → the no-CI path');
    expect(text).toContain('No-CI path, head `fixerHead` and not `gatedHead`: `gatedHead = head`');
  });
  it('ship bounds the CI wait at 60 minutes from `ciSince` (acr on #306)', () => {
    const text = one(ship());
    expect(text).toMatch(/"ciSince": null/);
    const ci = text.slice(text.indexOf('### ci'), text.indexOf('### sync'));
    expect(ci).toContain('`ciSince` is set when the row enters `ci`');
    expect(ci).toContain(
      'Still pending 60 minutes after `ciSince`, or a `pull_request` workflow that has reported nothing by then (path filters can skip a PR) → a stuck row naming the pending checks',
    );
    expect(ci).toContain('Under 60 minutes is a wait');
  });
  it('review-pr-findings assesses inline, dispatches only for block or INVALID, and keeps findings notes', () => {
    const text = read('skills/review-pr-findings/SKILL.md');
    expect(text).not.toMatch(/ledger file|ledger row|the ledger already/);
    expect(text).toMatch(/## Step 2: findings notes/);
    expect(one(text)).toContain(
      'Assess each finding yourself: steelman it with a concrete failure, then try to refute it in the code. Dispatch a subagent only for a block finding, or before you answer INVALID.',
    );
    expect(one(text)).toContain('Finish Steps 4 to 6 for every other finding and push before asking; the ask is the last call of the turn.');
    expect(one(text)).toContain('take a verified-minor when the fix is under about 20 lines and answer the rest');
  });
  it('the fixer agent and merge-pr call them findings notes too', () => {
    for (const text of [agent('fixer'), mergePr()]) {
      expect(text).not.toMatch(/findings\s+ledger/);
      expect(text).toMatch(/findings\s+notes/);
    }
  });
  it('ship checks a UI diff for the Drive line verify requires (HIVE-417 item 13)', () => {
    const text = one(ship());
    const intake = text.slice(text.indexOf('| `intake` |'), text.indexOf('| `self-review` |'));
    expect(intake).toContain('`gh pr diff <N> --repo <owner>/<repo> --name-only`');
    expect(intake).toMatch(/`\.tsx`, a `\.css`/);
    expect(intake).toMatch(/neither a `Drive:` line nor `owed: drive`/);
    expect(intake).toMatch(/a stuck row/);
    expect(one(read('skills/verify/SKILL.md'))).toContain('needs a `Drive:` line in the PR body');
  });
  it('the Drive trigger skips test files (acr on #308)', () => {
    const text = one(ship());
    const intake = text.slice(text.indexOf('| `intake` |'), text.indexOf('| `self-review` |'));
    expect(intake).toContain('outside `tests/`, `__mocks__/` and `e2e/`, not named `*.test.*` or `*.spec.*`');
  });
  it('the builder fills spec, plan and notes in the intake', () => {
    const step8 = agent('builder').slice(agent('builder').indexOf('8. `ship: yes`'));
    expect(one(step8)).toMatch(/`spec:` and `plan:` from the job \(`none` when the job had none\), `notes:` your `progress\.md`/);
    expect(fillIncludes(agent('builder'))).toMatch(/notes: \/abs\/path \| none/);
  });
});
