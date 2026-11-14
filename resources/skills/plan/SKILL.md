---
name: plan
description: Use when a spec or an approved design exists and the work is more than one step, before touching code. Writes the plan a builder run or an inline execute run follows task by task. Tasks name behaviour, files and tests, each marked risk-bearing or not, with implementation code only on the risk-bearing ones, and a ticket over thirteen points becomes more than one PR.
---

# Plan

Write for an engineer with zero context on this codebase and questionable
taste: skilled, but new to the toolset and the domain, and not to be trusted
with "add appropriate error handling". Every task carries what they need:
which behaviour, which files, what test, how to run it. DRY. YAGNI. TDD. A
commit per task.

Save to `<repo>/.hive/plans/YYYY-MM-DD-<slug>.md`. `.hive/` is a working
folder: write `<repo>/.hive/.gitignore` with the single line `*` if it is not
there, whichever skill gets there first.

## Scope check first

A spec that covers independent subsystems should have been split in
`brainstorm`. If it was not, split here: one plan per subsystem, each producing
working software on its own.

**A ticket over thirteen points is more than one PR.** Name each PR and which
tasks belong to it in the header. A split's PRs build **one at a time, in
order**, even when they are independent: PR 2 is held on PR 1 (`meta.after`),
PR 3 on PR 2. The Plan tab follows one build per session (HIVE-359). Name that
order in the header.

## File structure before tasks

Map which files are created or modified and what each is responsible for. One
responsibility per file; files that change together live together; follow the
patterns the codebase already has, and split a file you are modifying only when
it has grown past what a reader holds at once.

## Header (required)

```markdown
# <Feature> plan

Goal: <one sentence>
Spec: .hive/specs/<file>            (or: none, bounded change)
Ticket: HIVE-123                    (or: none)
PRs: 1 | N (name each PR's tasks)
PR: n of N                          (each plan of a split; omit for one PR)
Closes ticket: yes | no             (yes only on the last PR of a split)
Environment: Node <.nvmrc>; services: <none | docker stack, how to start>
Verification: <the specs and live suites beyond lint, type-check and coverage;
  for any task that touches a component or style, the drive: what to open,
  what to check, light and dark, the narrow width; and which of these may be
  left to CI>
Global constraints:
  - <copied verbatim from AGENTS.md and the spec: version floors, naming,
     import zones, the test mirror, the 80% gate, no coverage-ignore>
  - Touch together: a new CH channel bumps REMOTE_PROTOCOL_VERSION; a new
    bridge verb goes in tests/support/bridge-keys.ts; a changed selector
    updates docs/state-and-data.md; every new src file gets its mirrored test.
Architecture: <two or three sentences>
```

Every task's requirements include the global constraints.

Setup is the caller's. The builder, inline `work-on` and `goal-on` cut the
worktree and branch before `execute` runs, so never write a branch or worktree
task: Task 1 is the first change. Never write a gate task either: `verify` is
the caller's and a plan cannot waive it.

## Task block (required shape)

````markdown
## Task N: <name>                     risk: yes | no

Files:
- Create: exact/path
- Modify: exact/path:120-160
- Test:   tests/exact/path (mirrors src)

Interfaces:
- Consumes: <exact names and types from earlier tasks>
- Produces: <exact names and types later tasks rely on>

Behaviour:
- <what the change does, as the caller and the user see it>

Steps:
- [ ] Write the failing test         (what it asserts; the code in a fence on risk tasks)
- [ ] Run it, see it fail            (the command and the expected failure)
- [ ] Minimal implementation         (the code in a fence on `risk: yes` tasks only)
- [ ] Run it, see it pass            (the command)
- [ ] Scoped lint and type-check     (the repository's own lint and type-check on the touched paths)
- [ ] Commit                         (`git add …; git commit -m "…"`)

Done when: <command> prints <output>
````

Task blocks name behaviour, files and tests. Implementation code only for
`risk: yes` tasks. Never implement to check the plan.

`risk: yes` when the task touches auth, a credential, a token, a wire format,
concurrency, money or a security predicate, when it writes twice in one step,
or when it deviates from the ticket. Only those tasks get a reviewer subagent
in `execute`; the rest are read by the controller.

## No placeholders

Plan failures, never written: "TBD", "TODO", "later", "add validation",
"handle edge cases", "write tests for the above" without the test, "similar to
Task N" (repeat the code; tasks are read out of order), a step that says what
without showing how, a type or function no task defines.

## Self-review, inline

1. Spec coverage: every requirement points at a task. Add the missing ones.
2. Placeholder scan, against the list above.
3. Type consistency: names and signatures in later tasks match earlier ones.
4. Spec consistency: two requirements that conflict get a ruling in the plan
   header, and the spec is amended to match, so the builder never finds it.
5. Failure pass. For every await, write, transaction and network call in the
   plan's code, write one line beside it: what the caller sees when it throws,
   returns empty, or half-finishes. Two writes in one step (row then row, row
   then email, file then state) say which one may fail alone and what the
   retry finds. Each line that is not "nothing" becomes a test in that task.
6. Every surface. A control rendered on more than one route, role or width
   names each one it must work on, and the test covers the narrowest and the
   least privileged.
7. Census. For each field, channel, bridge verb or capability a task adds,
   grep the tests for a sibling's name; every list or count test that names
   the sibling goes in that task's Files, with the protocol version if earlier
   additions bumped it.

Fix in place. No re-review.

## Handoff

Return to the caller. `work-on` decides builder versus inline; `goal-on` runs
the plan itself. This skill never asks which; the "subagent-driven or inline"
menu is gone on purpose.
