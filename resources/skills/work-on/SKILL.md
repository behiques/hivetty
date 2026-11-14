---
name: work-on
description: Use when a Hive session starts work on a Jira ticket. "work on HIVE-123", "start ABC-42", the next story in an Epic, or a session opened from the Work tab. Reads the ticket, reconciles it against the code as it is today, stops only when that needs a decision, brainstorms and plans in the terminal, then hands the plan to the builder agent or executes it inline. Use goal-on when there is no ticket.
---

# Work on a ticket

Ticket specs go stale. The codebase moves after the ticket was written: earlier
stories in the Epic, merged PRs, renamed modules. So the first thing this skill
does is reconcile the ticket against the code as it exists **today**, and the
codebase is the source of truth. Then it plans. Then the work leaves the
terminal.

The lifecycle: reconcile → gate → brainstorm → plan → build (builder agent, or
inline) → draft PR → shipper agent → merged, ticket Done.

**One stop, and one more only when it is needed.** The design approval inside
`brainstorm` (the in-chat design for a bounded change, the spec for an
architectural one) always stops. The reconciliation stops only when the
reconciliation needs a decision; a clean one is reported and work continues.
Nothing else ends the turn to ask "shall I continue?": brainstorm's questions
go out in one batch, the draft PR opens with no menu, and the shipper is asked
in the same turn the PR exists.

## Inputs

`<KEY>` (required, `[A-Za-z]+-[0-9]+`, uppercased; missing → ask once).
`--inline`: execute the plan in this session instead of handing it to the
builder. `--detach`: hand off and close this session now; the builder asks the
overmind instead of this session.

## Steps

**1. Fetch the ticket.** `{{tool:jira_get}} { key }` when this session has
HiveTTY's tools: the description, the parent, every comment and link in one
call, through the token the Work tab holds. Otherwise the `jira-tracker`
skill's `get_issue <KEY>` (the Atlassian MCP tools if it is not installed;
never raw REST). Keep the fetch lean:

- Full body and every comment of the target ticket.
- The Epic's summary, not its body.
- Sibling stories as key, title and status, plus a scan of their comments for
  anything that amends scope or acceptance criteria.
- Full body and comments of issues directly linked to the target.

A comment that amends scope, a decision or an acceptance criterion is
**authoritative over the description**. Carry every such amendment, and every
description-versus-comment contradiction, into the reconciliation as a
candidate deviation.

**2. Reconcile against the code.** Dispatch one to three `Explore` subagents in
one response, one per subsystem the ticket names, a cheaper model is fine.
Each gets the ticket excerpt that concerns it and returns a short verdict with
`file:line` evidence per mismatch, never file dumps:

- Does anything the ticket asks for already exist, wholly or in part?
- Do the paths, modules, schemas and interfaces it names still match reality?
- Did the linked prior work change an assumption the ticket relies on?
- Does the code already reflect a comment that amended the description?
- Is any part of this ticket already claimed or planned? Read the open claims
  (`ledger_read`), and grep `.hive/specs/` and `.hive/plans/` in the project
  checkout for this key and for the modules the ticket names.

**3. Report; stop only when the reconciliation needs a decision.** What the
ticket says, what the code says, each mismatch with a recommended resolution
(follow ticket / follow code / needs a decision), and whether the ticket text
should be updated. A mismatch marked "needs a decision", or a part already
claimed or planned elsewhere: put the questions in one `AskUserQuestion`,
recommended option first, and END YOUR TURN. Otherwise the report is the
message and work continues into step 4 in the same turn. A confirmed
deviation is propagated later by `spec-deviation`.

**4. Claim and design.** `ledger_claim <KEY>` so the fleet knows the ticket is
held. Then `{{skill:brainstorm}}` with the reconciliation findings as its input, then
`{{skill:plan}}`. Every question the design needs goes out in **one**
`AskUserQuestion` call, four questions at most, recommended option first. A
lone follow-up is allowed only when an answer changes what the next question
is. A design answer that takes scope from another open ticket, or gives scope
to one, is written to that ticket as an UPDATED SPECS comment in the same
turn, before planning.

**A UI surface** gets one browser-rendered HTML mockup of the recommended
design (the Artifact tool), and two or three variants only when the surface is
new to the app or the user asks. Show variants before writing any code.

**5. Dispatch.** The plan is approved; the terminal's job is done. In this
order, and one ask per turn: `ledger_ask` ends the turn, so every check comes
before it.

1. `{{tool:agents}}`. The builder path below needs `builder` listed, and the
   shipper handoff needs `shipper`; a machine without them runs inline, and an
   ask to a party that does not exist wakes nothing.
2. `{{tool:projects}}`: find the project whose `path` is this repo.
   `autoMerge: false` → tell the person in the dispatch message: "this project
   merges only on your inbox card: each clean PR will raise one. To merge
   unattended, turn on Settings › Projects › ⋯ › Merge PRs unattended." Never
   change `autoMerge` yourself, in the config or any other way; it is the
   person's consent.
3. Overlaps: `gh pr list --state open --repo <owner>/<repo>`, and the open
   build asks and claims on the ledger (`ledger_read`). A sibling touching the
   same files is named in the ask as `overlaps:`, or the ask is held on it
   (`meta.after`, below).
4. Write `.hive/plans/<slug>.state.md` in the project checkout: the PR chain,
   the asks posted, the steps still owed (`spec-deviation`, a held ask), and
   this session's id. After a compaction the first act is to read it; update
   it each time an ask goes out or an answer comes back.

*Default when `builder` exists: the builder agent.* Release the claim
(`ledger_release <KEY>`; the builder re-claims), then post one ask and stay on
the line. Nothing after it runs until you are woken:

```
ledger_ask
  to: builder
  body: |
    Build <KEY>: <ticket title>
    repo: /abs/path/to/checkout
    ticket: <KEY>
    branch: feat/<key>-<slug>
    base: origin/main                        (or: after #N)
    pr-title: <KEY>: <what the PR does>
    plan: /abs/path/to/checkout/.hive/plans/YYYY-MM-DD-<slug>.md
    spec: /abs/path/to/checkout/.hive/specs/YYYY-MM-DD-<slug>.md   (or: none)
    verify: <the plan's Verification: line, and what may go to CI>
    env: <the plan's Environment: line: Node version, services up or not>
    part: n of N                             (a split only)
    closes-ticket: yes | no                  (the plan's Closes ticket:; no on every part but the last)
    overlaps: <#N or KEY touching the same files>   (or: none)
    ship: yes
    key-confirmed: yes                       (the key came from this invocation)
    reply-to: <$HIVE_SESSION_ID, sess-…>     (overmind with --detach)
  meta: { ticket: "<KEY>", repo: "<owner>/<repo>", plan: "...", stage: "build",
          intent: "wait for the builder; answer its questions from the spec" }
```

`plan:` and `spec:` are absolute: `.hive/` is ignored, so a relative path
resolves nowhere in the builder's fresh worktree. The plan already marks its
risk-bearing tasks; never list them again in the ask.

A plan split into PRs is one ask per PR, and they build **one at a time**: the
Plan tab follows one build per session (HIVE-359). Post PR 1's ask now; every
later PR goes out held on the one before it, even when independent.

A PR that must wait for another to merge goes out as a held ask: add
`meta.after: "<owner>/<repo>#<N>"` naming the PR it depends on, and it reaches
the builder only when that PR's shipper `closed` entry lands. It waits up to
seven days. The number exists only once the earlier PR is open, so carry the
rest of the chain in the first ask's `meta.intent` and in the state file
("when A opens as #N, post B with `after: <owner>/<repo>#N`"), and post the
next held ask on the wake that brings the number. One ask per turn.

*Attached (default, for every plan).* Stay open. A `📒` marker from the
builder is a question:

- Answered by the spec, the plan or this conversation: `ledger_answer` it and
  say where ("per spec §3").
- An operational question (a missing service, a tool, a path, which gate runs where) is yours: answer it or do it.
- A reversible choice with a recommended option (open a draft PR is one):
  answer the builder with that option, and tell the person in the session
  what you chose.
- A decision that is not reversible goes to the person as one
  `AskUserQuestion`, recommended option first; you relay the answer.
- The builder answers `failed:` or `blocked:` → tell the person what it said
  and stop; never re-post the ask unchanged.
- A refusal note on the build ask's thread (`meta.refused`) → tell the person
  the reason and stop.

The shipper's "PR #N merged" arrives as a notice with nothing owed back; run
`/done` once your own work is finished (the state file says what is still
owed). When this session posted the ship ask itself (the inline path), the
merge arrives as the answer to that ask instead. Closing the terminal earlier
is fine: an ask to a session that is gone falls back to the overmind.

When the person asks about a PR or a build, call `{{tool:pr}}` first and read its `ship` block. Never infer a
stall from `gh pr view` or from a thread you can only partly read, and never post a rescue ask on an inferred cause.

*Detached (`--detach`).* `reply-to: overmind`, then `/done` now.

*Inline (`--inline`, no `builder` on this machine, or a plan of one task).*

1. `{{skill:worktree}}` on `feat/<key>-<slug>`.
2. Jira → In Progress and assigned to you: `{{tool:jira_transition}} { key,
   status: "In Progress", from: "To Do", assignToMe: true }`, where `from`
   leaves a ticket already past To Do alone and `assignToMe` fills an empty
   assignee with the Jira token's owner, moved or not; someone else's ticket
   keeps its assignee and the answer names them. Without HiveTTY's tools, the
   `jira-tracker` skill: read the status and assignee with `get_issue <KEY>
   status,assignee`; if it is still To Do, take the In Progress id from
   `get_transitions <KEY>` and call `transition_issue <KEY> <id>`; if it is
   unassigned, take your `accountId` from `lookup_user "$JIRA_EMAIL"` and call
   `update_issue <KEY> '{"assignee":{"accountId":"<id>"}}'`.
3. `{{skill:execute}}`.
4. Load {{skill:verify}} now (in Claude Code, call the Skill tool); do not run the gate from memory.
   The full gate runs on the exact tree you will push: lint, type-check, the
   unit suite, and e2e or a browser drive when the change has a UI surface.
5. `git push -u origin <branch>`.
6. `gh pr create --draft` with what changed and how it was verified. Draft,
   always: the shipper marks it ready. Never present a merge menu.
7. `ledger_release <KEY>`.
8. `shipper` listed by `{{tool:agents}}`: ask the shipper in the same turn the
   PR exists, with `reply-to: $HIVE_SESSION_ID` and `key-confirmed: yes` (the
   key came from this invocation):

{{include:ship-intake}}

   A `ledger_ask` that comes back as a duplicate wrote nothing: wait when the
   first ask was this session's own; when it was someone else's, neither wait
   nor re-post. Then stay for the shipper's answer, or `/done`. No shipper on
   this machine: say the draft PR is ready and stop.

The final message names the PR, the gates run, and "UI not driven" when the
change has a UI surface and no browser drove it.

## The branch carries the key, the ask carries the truth

`feat/<key>-<slug>` is the convention, and it is the cheapest injection there
is: the author writes it. The shipper and `merge-pr` transition a ticket only
on a key handed to them with `key-confirmed: yes`, which this skill sets
because the key came from its own arguments. Never from a branch name.

## Red flags

- A plan written from the ticket text alone. Reconcile first.
- Stopping on a clean reconciliation report, "no deviations, proceed?".
- Reconciling against the description while a comment already changed it.
- Brainstorm questions one per turn.
- Three mockup variants for a pattern the app already has.
- A ticket In Progress with nobody on it. Pass `assignToMe`; Jira's default
  assignee varies by project.
- Relaying an operational builder question to the person. It is yours.
- Making an irreversible decision for the person. That one is theirs.
- A scope moved between tickets recorded only in a gitignored spec.
- A plugin skill from outside HiveTTY as a step of the process. This skill
  and its siblings are the whole process; the Jira CLI fallbacks are tools,
  not steps.
