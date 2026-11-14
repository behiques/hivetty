---
name: verify
description: Use before claiming any work complete, fixed or passing, and before pushing, opening a PR or reporting done to the ledger. Runs the repository's own gates, drives a UI change in a real browser, and records the output as evidence. No claim without fresh output in the same message.
---

# Verify

```
NO COMPLETION CLAIM WITHOUT FRESH EVIDENCE
```

If the command did not run in this message, its result is not known.

## The gate

1. **Identify** the commands that prove the claim from the repository's
   `AGENTS.md`, `package.json` or `Makefile`: lint, type-check, the unit
   tests, the e2e when behaviour moved or several files did, a live suite
   when its subject moved. Run them under the repository's pinned runtime
   (`.nvmrc`), not the shell's.
2. **Run** it, whole, on the exact tree you will push. `git status` clean of
   stray files first. A caller may name a scope (a fix round runs the touched
   paths); with none, whole.
3. **Read** the output. Exit code, failure count, the runner's own totals. A
   background wrapper's exit code can be the echo's; a background vitest off a
   TTY prints totals only.
4. **Judge.** Output confirms the claim → make the claim, with the output.
   Output does not → state what actually happened, with the output.
5. **UI surface** (a component, a style, a layout, a role): drive it. The
   Playwright spec for the touched surface, or open the built app (the
   repository's own build first, as its AGENTS.md says). Green unit tests do
   not prove a render. A plan cannot waive this. A diff that touches a
   component or a style needs a `Drive:` line in the PR body: the widths (375
   and 1440) and the roles or fixtures driven.
6. **Clean up** after a drive. Stop every dev server you started for it: a
   leftover background shell holds a ledger nudge to the session for up to
   60 s. Screenshots and drive logs go outside the worktree, to
   `<hive>/work/<agent>/shots/<ticket>/` for an agent and
   `<repo>/.hive/shots/<ticket>/` for a session, and the answer names the
   folder. Read screenshots downscaled: full-size ones were 63% of one 24 MB
   session.

## A gate this machine cannot run

Prove it first: the command, its output, and the install paths checked. Try
to start a missing service (`open -a Docker`, wait for `docker info`). Then,
for e2e that CI runs: open the draft, put
`Not run locally: <gate>, <why>; CI is its first run` first in the PR body's
Verification and in the answer. Do not ask. For a drive on a UI change: the
answer's first line reads `built, drive owed`, and the ship ask carries
`owed: drive`. Ask only when neither CI nor a person can run it.

## Where the evidence goes

- A goal brief: appended under `## Verification evidence`. The verifier reads
  that section, not the conversation.
- A PR body: a "Verification" section with the commands and their last lines.
- A ledger job: the `ledger_post` or `ledger_answer` that reports the stage,
  in its body.
- A subagent's report: the command and its last line. A subagent that says
  "all green" with no output has not verified; check the VCS diff yourself.

## Claims and what they need

| Claim | Needs | Is not |
| --- | --- | --- |
| tests pass | the run, 0 failures | an earlier run, "should pass" |
| lint clean | the run, 0 errors | a partial path |
| build passes | exit 0 from the build | lint passing |
| bug fixed | the reproducing test, red then green | code changed |
| regression test works | pass → revert fix → fail → restore → pass | passes once |
| agent completed | the diff | the agent's report |
| requirements met | the plan re-read as a checklist | tests passing |

## Red flags

"should", "probably", "seems to", "Great!" before the output, "just this
once", a claim in a different wording so the rule does not apply.
