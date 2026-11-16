---
name: ship
description: >-
  The PR endgame, run by the shipper agent on every wake. Drives a draft PR to merge one stage at a
  time: self review through the reviewer agent, mark ready, CI, findings through fixer, approval or
  the auto-merge fence, merge-pr, Jira Done. A session hands a PR over with one ledger_ask to
  shipper; in a terminal this skill only explains how.
---

# Ship

A state machine the shipper advances one wake at a time, woken by the ledger
and a thirty-minute clock. Nothing sleeps inside a turn except merge-pr's bounded `UNKNOWN` re-read.
Claim, answer, release, denial and expiry follow the run contract.

## Intake

{{include:ship-intake}}

Intake order: `ledger_claim <owner>/<repo>#<N>`, then `ledger_accept <ask id>`,
then write the row, before any other row's work:

```json
{ "pr": 214, "repo": "behiques/hivetty", "path": "/abs/path", "worktree": null,
  "ticket": "HIVE-123", "keyConfirmed": true, "closesTicket": true, "replyTo": "sess-…",
  "ask": "20261113-101500-0001", "asker": "builder", "spec": null, "plan": null, "notes": null,
  "stage": "intake", "waitingOn": null, "since": null, "rounds": 0, "askHead": null,
  "fixerHead": null, "gatedHead": null, "ciSince": null }
```

`spec`, `plan`, `notes`: the intake's paths, `none` as `null`. `since` is
where findings are gathered from: `null` (the whole PR), then each `clean`
answer's `gathered` time, never now. Every way a row leaves answers its `ask`.

## Lanes

One conversation and directory per repository. Its `prs.json` holds only that
repository's rows; a missing `prs.json` is no rows; it is written with the
first row (`test -f` before reading). Lane facts live in `lane.json` beside it.
The standing lane never advances a row: it hands a PR to its repo lane with a
self-addressed `ledger_ask to: shipper` carrying `meta.repo`, no `key`.

{{include:literal-target}}

## Stages

On a stage change: one `ledger_post` with `meta: { pr,
repo, stage }`, and fall through in the same wake. A row stops only where it
waits (CI pending, or `waitingOn` naming `acr`, `fixer` or `reply-to`), with
one `ledger_post` naming the stage and what it waits on. The write that records an answer
clears `waitingOn`. Write `prs.json` whenever a field
changes, and before any `ledger_ask`, which ends the wake. One merge per wake
does not end the wake while a row sits at `intake`: run that row to its acr
ask.

Before stage work, except at `merge` and `closed`, read `gh pr view <N> --repo
<owner>/<repo> --json state`: `MERGED` → `merge`; `CLOSED` → release, remove
the row, answer its `ask`.

An overmind `meta.kind: auto-merge` post re-runs `approval` for rows in its
`meta.repo` (without one, rows on its `meta.path`); a row at `merge` without
consent goes back to `approval`.

An overmind post with `meta.changed` (`owner/repo#N changed: checks running →
passing`) means the PR at `meta.repo`, `meta.pr` moved on GitHub: re-run
that row's stage check in this wake.

**Pending-fix check**, first at `findings`, `approval` and `merge`:
`ledger_read { limit: 0 }`; `claims["<owner>/<repo>#<N> findings"]` held by
anyone stops the row, with no ask.

| Stage | This wake | Advance when |
| --- | --- | --- |
| `intake` | `gh pr view <N> --repo <owner>/<repo> --json state,isDraft,headRefName,body`; force draft with `gh pr ready <N> --repo <owner>/<repo> --undo`. `gh pr diff <N> --repo <owner>/<repo> --name-only` lists a `.tsx`, a `.css` or a `components/`/`styles/` file, and the body has neither a `Drive:` line nor `owed: drive` → a stuck row | → `self-review` |
| `self-review` | `{{tool:agents}}` lists `acr`: `waitingOn: acr`, then the acr ask (below). No `acr`: ask `reply-to`, options `[reviewed elsewhere, skip the self review]` | acr's answer (below) |
| `fix-self` | `fixer` listed: `waitingOn: fixer`, `ledger_ask to: fixer` (below). No fixer: ask `reply-to`, options `[fixed, park them]` | the fixer's answer (below); fixed → `ready` |
| `ready` | `gh pr ready <N> --repo <owner>/<repo>`; only if `keyConfirmed` and the ticket is before In Review: `{{tool:jira_transition}} { key, status: "In Review" }` (or the `jira-tracker` skill) | → `ci` |
| `ci` | see below | green → `findings`; red → `ledger_ask to: fixer` with the failing checks |
| `findings` | `{{tool:pr}} { repo: "<owner>/<repo>", number: <N> }`: unresolved threads are a finding. The gather, `gh pr view <N> --repo <owner>/<repo> --json reviews,comments,latestReviews,statusCheckRollup`, newer than `since`: every review with a body, any state; a bodyless `COMMENTED` or `CHANGES_REQUESTED` review as "inline review <id> by <author>"; a bodyless `APPROVED` carries nothing and is left out, as is a bodyless review whose author posted a `<!-- hive-fixer` comment on this PR; every PR-level comment; red checks. Leave out `<!-- hive-fixer` comments, ids they name, LGTM-only bodies. An approval asking for a change is a finding. Any → `ledger_ask to: fixer`, each with author and `id` | `clean`, nothing newer → `approval` |
| `approval` | see below | → `merge` |
| `merge` | Sync; the gather again. Anything → `findings`. Nothing → `{{skill:merge-pr}} <owner>/<repo>#<N> <worktree-or-path> [KEY only if keyConfirmed] [closes-ticket: no when closesTicket is false]` | `merged` → `closed`; a thread HOLD → `findings` |
| `closed` | `ledger_release <owner>/<repo>#<N>`; remove the row; `ledger_answer <ask>` "PR #N merged", `meta: { pr, repo, stage: "closed" }`; also `ledger_post to: <reply-to>` (`ledger_done` for overmind) when it is not the asker | done |

### The fixer's answer

`meta: { result: "clean" | "blocked" | "blocked-on", rounds, gathered, head, pr, repo }`.
Read `meta.result`, never the body. `clean` → `since = gathered`, `rounds += 1`,
next stage. Every fixer ask sets `askHead` to the PR head; a `head` other than
it → `fixerHead = head`. `blocked-on` → the fixer ask again, with `meta.after` the PR it
names. `blocked`, or any other shape → a stuck row.

### self-review and fix-self

1. acr ask: `<pr url> --self`, then `SPEC=<spec> PLAN=<plan> NOTES=<notes>`,
   each only when the row holds a path.
2. Read acr's `meta`, never the body: `findings + borderline + verified_minor`
   above 0 → `fix-self`; all 0 → `ready` (`borderline`: confidence 60-74).
3. Fixer ask: `<owner>/<repo>#<N>`, `path`, `reply-to`, acr's `meta.report`.
   Findings, borderline and verified-minor all go to the fixer in one ask; the
   fixer takes a verified-minor when the fix is under about 20 lines and
   answers the rest.

### ci

1. Read per PR, at every `ci` stage, never kept as a lane fact:
   `gh pr checks <N> --repo <owner>/<repo>`. Checks reported → wait for them;
   exit 8 is pending, and a required check that is pending is not green.
2. No checks reported and no workflow triggered on `pull_request` → the no-CI
   path: green. Look in `.github/workflows/` at the PR head (`gh api
   repos/<owner>/<repo>/contents/.github/workflows?ref=<headRef>`); one with
   `pull_request` in its `on:` means checks are still to come: pending.
3. No-CI path, head `fixerHead` and not `gatedHead`: `gatedHead = head`,
   `waitingOn: fixer`, ask the fixer to run the repository's full gate once in
   the PR worktree; `clean` → green, else stuck.
4. `ciSince` is set when the row enters `ci`. Still pending 60 minutes after
   `ciSince`, or a `pull_request` workflow that has reported nothing by then
   (path filters can skip a PR) → a stuck row naming the pending checks.
   Under 60 minutes is a wait.

### sync (inside approval and merge)

1. `gh api repos/<owner>/<repo>/compare/<base>...<headRef> --jq .behind_by`
   is `0`: no workspace, no sync, next stage.
2. The workspace is the row's `worktree`, else `<path>`. On the head ref, or
   the row's own detached `worktree`, with an empty `git -C <workspace> status
   --porcelain`: sync there.
3. Otherwise, at `<path>` (the person's checkout): the `git -C <path>
   worktree list --porcelain` tree on `refs/heads/<headRef>`, or a new one
   (`<repo>` is `<path>`, `<branch>` is `<headRef>`), becomes the row's
   `worktree`. A refused add, or a dirty `worktree`, is stuck.

{{include:agent-worktree}}

4. `git -C <workspace> fetch origin`, then `git -C <workspace> merge --ff-only
   origin/<headRef>`, one call each; refused is a stuck row.
5. `git -C <workspace> merge origin/<base>` and one push; conflicts as merge-pr 2.6.

### approval

1. Sync; the gather again. Anything → `findings`.
2. `gh pr view <N> --repo <owner>/<repo> --json reviewDecision,reviewRequests,latestReviews`,
   reading (c) first:
   - (a) `APPROVED`, or `{{tool:projects}}` shows this checkout's project with
     `autoMerge: true` → `merge`.
   - (b) `reviewDecision` and `reviewRequests` both empty → `merge`. Without
     `autoMerge` the merge stops at the permission fence; the app tells the asker.
   - (c) `REVIEW_REQUIRED`, `CHANGES_REQUESTED`, or a requested review: once,
     `waitingOn: "reply-to"`, ask "PR #N waits on a review", options `[merge
     now, wait for review, hand back]`, no `merge now` when the decision blocks.
     `wait for review` → stay, no further asks.

## A stuck row

Asks `reply-to` once: `waitingOn: "reply-to"`, then `ledger_ask` with what is
stuck, options `[keep waiting, hand back, abandon]`. A hand back or abandon
releases and removes the row. Stuck: CI red with no
fixer, a refused sync, a fixer's `blocked`, an acr answer with `verdict:
"failed"` or `"empty"`, a permission card still open when next woken.

Every ask to `reply-to` carries `meta: { pr: <N>, repo: "<owner>/<repo>" }`;
never a post in its place.

## In a terminal

`{{skill:ship}}` prints the intake shape above and stops.
