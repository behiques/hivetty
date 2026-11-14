---
name: execute
description: Use when a written plan exists and it is time to build it. Runs the plan task by task with a commit each, inline by default; subagent mode only when the ask says `mode: subagent` or the person asks. Used by the builder agent and by work-on --inline and goal-on.
---

# Execute a plan

One skill, two modes, one set of prompts. The rules come from two audits of
real sessions (AGENTS.md, "Working a ticket"): the hours went to a serial
implement-review-re-review chain, and the whole-branch review at ship still
found what fifteen per-task reviews missed. So: inline by default, review only
where risk lives, two fix rounds, no re-review agent, and the seams belong to
ship's self review (the `pr-review` skill, run by the shipper's reviewer agent
once it ships, or by the person until then).

## Setup

1. Read the plan and its spec once. In a session, one todo per task, marked
   completed when its commit lands, or when its Done-when prints for a task
   with no commit. As the builder, the ledger posts are the plan panel: one
   `started` and one committed post for every task number, including each task
   of a batch. Read the plan critically first: a gap that stops you is raised
   now, not at task six.
2. `ledger_claim <ticket or plan slug>`, unless the caller already holds it
   (the builder claims before it invokes this skill). `<worktree>` is the
   tree you build in: the builder's worktree, or the session's checkout.
   Progress lines go to `<worktree>/.hive/sdd/<plan>/progress.md` (`<plan>`
   is the plan's file name without `.md`), one line per task and one per
   ruling: `Ruling: <what>; <why>; <cost if wrong>`. Make sure
   `<worktree>/.hive/.gitignore` exists with the single line `*` before the
   first commit; `brainstorm` writes it, but not every path runs brainstorm, and a
   per-task `git add` would otherwise sweep the progress file into the PR.
3. Pre-flight conflict scan: one row per pair of tasks that share a file or
   an interface, and one per task's own consistency. Rulings, never questions.
4. Environment, once, logged to `progress.md` and repeated in the answer:
   `node -v` against `.nvmrc`; for a plan whose Verification needs Docker,
   `command -v docker || ls ~/.docker/bin/docker /usr/local/bin/docker /Applications/Docker.app/Contents/Resources/bin/docker`;
   the Playwright browser.

## Mode: inline (default)

You are the implementer. The loop every task's code goes through:

{{include:tdd-loop}}

For each task, in order:

1. Failing test, run it, read the failure (RED).
2. Minimal code, run it, read the pass (GREEN).
3. The repository's own lint and type-check on the touched paths.
4. Commit with the task's name.
5. `risk: yes` → one reviewer subagent on that task's diff
   (`prompts/task-reviewer.md`), most capable model, dispatched as
   `subagent_type: "Explore"` (no Edit or Write; the prompt's git allowlist is
   the fence for its Bash). Fix Critical
   and Important yourself, prove each fix with the test that fails without
   it, and stop after two rounds: park what is left with a ruling. A
   consequence the reviewer names that the plan does not state (a retry that
   cannot repair, a path the test never takes) is not Minor: `ledger_ask` the
   reply-to party before the next task. A parked gap is a `test.todo` naming
   it, never only a sentence in the PR body.
6. `risk: no` → read the diff yourself against the task block and move on.
7. Read the diff before the next task, whatever the risk.

## Mode: subagent

The builder runs inline. Subagent mode is for a run whose ask says
`mode: subagent`, or a session where the person asks. Decided before the first
dispatch and not revisited.

Per task: `prompts/implementer.md` with the task block, the worktree path and
the branch; never paste prior tasks' history; batch small same-shape tasks
into one dispatch. Handle `DONE`, `DONE_WITH_CONCERNS` (read the concerns,
rule), `NEEDS_CONTEXT` (answer it, dispatch again with the answer in the
prompt), `BLOCKED` (rule or stop). Then the same review rule as inline. The
fix round is dispatched to a fresh implementer, given the task block, the
commit range and the findings; it returns the failing test as proof. Two
rounds, then park with a ruling.

**One writer per worktree.** Two implementers in one checkout share one git
index, and that couples them even when their files are disjoint. Parallel
writing happens only at the PR grain: separate worktree, separate branch,
separate builder run. Parallel **reading** is free: reconciliation, finding
assessments, research, all dispatched in one response.

Every dispatched prompt opens with the absolute worktree path and the
branch, and requires `git -C "$WT"` on every command and a branch assertion
before every commit. A commit that landed anywhere else is a failed task:
reset it and re-dispatch.

## Before the gate: re-read the plan

No per-task check agent. After the last task and before `verify`, re-read the
plan's task headings and Done-when lines against
`git diff origin/<default>...HEAD --stat`: a task with no diff, or a diff no
task names, is a ruling in the answer.

## When a task runs long

A task past 10 minutes, a command that times out, or a reply cut off
mid-stream: stop and check the machine before the plan
(`date; uptime; pmset -g log | grep -E 'Sleep|Wake' | tail -5; node -v; cat .nvmrc`).
A machine that slept: in a session, re-run the gate under `caffeinate -i` and
say so in the next post (an agent run already holds a power-save blocker). A
wrong Node: switch and re-run. Re-split only when the machine is clean and two
tasks in a row passed 10 minutes.

## What stops you

An irreversible operation, a security-sensitive action you were not told to
take, a side effect outside the worktree (push, publish, merge), or a plan so
broken every path is a guess. In a session: ask, one batched call. As the
builder: `ledger_ask` the job's `reply-to` party with `options` and
`meta.intent` naming the task, then end the turn. Everything else is a ruling,
logged.

## Never

- Sleep-poll a dispatched subagent. Its notification is the wake-up.
- Dispatch a scoped re-review agent. The implementer proves its fix; you
  adjudicate the proof.
- Fan reviewers out by category on one task's diff.
- Run a final whole-branch review here. That is ship's self review.
- Fix a reviewer's finding in the controller when an implementer holds the
  task. The fix round is a fresh implementer's.

## Exit

All tasks committed on the branch, then `{{skill:verify}}` run once, whole, on
the tree as it stands, and green; rulings collected under "Rulings I made" in
`progress.md`. That is the one full gate: the caller reports its result and
does not run it again. Return to the caller, which pushes and opens the draft
PR.
