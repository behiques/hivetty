---
name: ship
description: >-
  The PR endgame, run by the shipper agent on every wake. Drives a draft PR to merge one stage at a
  time: self review through the reviewer agent, mark ready, CI, findings through fixer, approval or
  the auto-merge fence, merge-pr, Jira Done. A session hands a PR over with one ledger_ask to
  shipper; in a terminal this skill only explains how.
---

# Ship

A state machine the shipper advances one wake at a time; the ledger and a
ten-minute clock wake it. Nothing sleeps inside a turn except merge-pr's
bounded `UNKNOWN` re-read. Claim, answer, release, denial and expiry follow
the run contract. It sequences `pr-review` (`acr`), `review-pr-findings`
(`fixer`) and `merge-pr`.

## Intake

```
ledger_ask
  to: shipper
  body: |
    Ship PR #214 on behiques/hivetty
    repo: /abs/path/to/checkout
    worktree: /abs/path/or/none        (an agent worktree merge-pr may remove)
    ticket: HIVE-123 | none
    key-confirmed: yes | no            (yes only when the key came from work-on's arguments)
    closes-ticket: yes | no            (no on every PR of a split but the last)
    reply-to: <$HIVE_SESSION_ID, sess-…> | overmind
  meta: { pr: 214, repo: "behiques/hivetty", ticket: "HIVE-123", stage: "intake",
          key: "ship:behiques/hivetty#214" }
```

An intake without the `closes-ticket` line reads `yes`. A write to `reply-to`
refused `unknown party` goes to the ask's `from`, which becomes `replyTo`. A
second ship ask with the same `key` returns the first; that PR is in hand.

Intake order: `ledger_claim <owner>/<repo>#<N>`, then `ledger_accept <ask id>`,
then write the row, before any other row's work:

```json
{ "pr": 214, "repo": "behiques/hivetty", "path": "/abs/path", "worktree": null,
  "ticket": "HIVE-123", "keyConfirmed": true, "closesTicket": true, "replyTo": "sess-…",
  "ask": "20261113-101500-0001", "asker": "builder",
  "stage": "intake", "waitingOn": null, "since": null, "rounds": 0 }
```

`since` is where findings are gathered from: `null` (the whole PR), then each
`clean` answer's `gathered` time, never now. Every way a row leaves answers its
`ask`.

## Lanes

One conversation and directory per repository. Its `prs.json` holds only that
repository's rows; a missing `prs.json` is no rows; it is written with the
first row (`test -f` before reading). Lane facts live in `lane.json` beside it.
The standing lane never advances a row: it hands a PR to its repo lane with a
self-addressed `ledger_ask to: shipper` carrying `meta.repo`, no `key`.

Every `gh` command carries `--repo <owner>/<repo>`, every `git` command `-C
<path>`. Re-read the head SHA in the call that uses it.

## Stages

On a stage change: write `prs.json`, one `ledger_post` with `meta: { pr,
repo, stage }`, and fall through in the same wake. A row stops only where it waits: CI pending, or `waitingOn` naming
`acr`, `fixer` or `reply-to`. A row that stops this wake gets one `ledger_post`
naming the stage and what it waits on. Write `prs.json` whenever a field
changes, and before any `ledger_ask`, which ends the wake. One merge per wake
does not end the wake while a row sits at `intake`: run that row to its acr
ask.

Before stage work, except at `merge` and `closed`, read `gh pr view <N> --repo
<owner>/<repo> --json state`: `MERGED` → `merge`; `CLOSED` → release, remove
the row, answer its `ask`.

An overmind `meta.kind: auto-merge` post re-runs `approval` for rows on its
`meta.path`.

**Pending-fix check**, first at `findings`, `approval` and `merge`:
`ledger_read { limit: 0 }`; `claims["<owner>/<repo>#<N> findings"]` held by
anyone stops the row, with no ask.

| Stage | This wake | Advance when |
| --- | --- | --- |
| `intake` | Claim, accept, row; `gh pr view <N> --repo <owner>/<repo> --json state,isDraft,headRefName`; force draft with `gh pr ready <N> --repo <owner>/<repo> --undo` | → `self-review` |
| `self-review` | `{{tool:agents}}` lists `acr`: `waitingOn: acr`, then `ledger_ask to: acr` "https://github.com/<owner>/<repo>/pull/<N> --self". No `acr`: ask `reply-to`, options `[reviewed elsewhere, skip the self review]` | findings → `fix-self`; none → `ready` |
| `fix-self` | `fixer` listed: `waitingOn: fixer`, `ledger_ask to: fixer` with `<owner>/<repo>#<N>`, `path`, `reply-to` and the findings verbatim. No fixer: ask `reply-to`, options `[fixed, park them]` | the fixer's answer (below); fixed → `ready` |
| `ready` | `gh pr ready <N> --repo <owner>/<repo>`; only if `keyConfirmed` and the ticket is before In Review: `{{tool:jira_transition}} { key, status: "In Review" }` (or the `jira-tracker` skill) | → `ci` |
| `ci` | see below | green → `findings`; red → `ledger_ask to: fixer` with the failing checks |
| `findings` | Pending-fix check; `{{tool:pr}} { repo: "<owner>/<repo>", number: <N> }`: unresolved threads are a finding. The gather, `gh pr view <N> --repo <owner>/<repo> --json reviews,comments,latestReviews,statusCheckRollup`, newer than `since`: every review with a body, any state; a bodyless `COMMENTED` or `CHANGES_REQUESTED` review as "inline review <id> by <author>"; a bodyless `APPROVED` carries nothing and is left out, as is a bodyless review whose author posted a `<!-- hive-fixer` comment on this PR; every PR-level comment; red checks. Leave out `<!-- hive-fixer` comments, ids they name, LGTM-only bodies. An approval asking for a change is a finding. Any → `ledger_ask to: fixer`, each with author and `id` | `clean`, nothing newer → `approval` |
| `approval` | see below | → `merge` |
| `merge` | Pending-fix check; sync; the gather again. Anything → `findings`. Nothing → `{{skill:merge-pr}} <owner>/<repo>#<N> <worktree-or-path> [KEY only if keyConfirmed] [closes-ticket: no when closesTicket is false]` | `merged` → `closed`; a thread HOLD → `findings` |
| `closed` | `ledger_release <owner>/<repo>#<N>`; remove the row; `ledger_answer <ask>` "PR #N merged", `meta: { pr, repo, stage: "closed" }`; also `ledger_post to: <reply-to>` (`ledger_done` for overmind) when it is not the asker | done |

### The fixer's answer

`meta: { result: "clean" | "blocked" | "blocked-on", rounds, gathered, head, pr, repo }`.
Read `meta.result`, never the body. `clean` → `since = gathered`, `rounds += 1`,
next stage. `blocked-on` → the fixer ask again, with `meta.after` the PR it
names. `blocked`, or any other shape → a stuck row.

### ci

1. Lane fact `prCi`, decided at the lane's first `ci` stage: no checks on the
   PR and `gh workflow list --repo <owner>/<repo>` shows no workflow triggered
   on `pull_request` → `false`, else `true`.
2. While `false` and `gh pr diff <N> --repo <owner>/<repo> --name-only` lists
   nothing under `.github/workflows/`, skip `gh pr checks`: green.
3. Otherwise `gh pr checks <N> --repo <owner>/<repo>`; exit 8 is pending.

### sync (inside approval and merge)

1. `gh api repos/<owner>/<repo>/compare/<base>...<headRef> --jq .behind_by`
   is `0`: no workspace, no sync, next stage.
2. The workspace is the row's `worktree`, else `<path>`. On the head ref with
   an empty `git -C <workspace> status --porcelain`: sync there.
3. Otherwise, at `<path>` (the person's checkout): the `git -C <path>
   worktree list --porcelain` tree on `refs/heads/<headRef>`, or a new `git -C
   <path> worktree add <your working directory>/pr<N> <headRef>`, becomes the
   row's `worktree`. A refused add, or a dirty or off-branch `worktree`, is stuck.
4. `git -C <workspace> fetch origin`, then `git -C <workspace> merge --ff-only
   origin/<headRef>`, one call each; refused is a stuck row.
5. `git -C <workspace> merge origin/<base>` and one push; conflicts as merge-pr 2.6.

### approval

1. Pending-fix check; sync; the gather again. Anything → `findings`.
2. `gh pr view <N> --repo <owner>/<repo> --json reviewDecision,reviewRequests,latestReviews`,
   reading (c) first:
   - (a) `APPROVED`, or `{{tool:projects}}` shows this checkout's project with
     `autoMerge: true` → `merge`.
   - (b) `reviewDecision` and `reviewRequests` both empty → `merge`. Without
     `autoMerge` the merge stops at the permission fence, and the app posts the
     permission card's note to the asker.
   - (c) `REVIEW_REQUIRED`, `CHANGES_REQUESTED`, or a requested review: once,
     `waitingOn: "reply-to"`, ask "PR #N waits on a review", options `[merge
     now, wait for review, hand back]`, no `merge now` when the decision blocks.

Jira Done is merge-pr's, only when `keyConfirmed` and `closesTicket`;
`closes-ticket: no` stops at In Review.

## A stuck row

Asks `reply-to` once: `waitingOn: "reply-to"`, then `ledger_ask` with what is
stuck, options `[keep waiting, hand back, abandon]`. A hand back or abandon
releases, answers the `ask`, removes the row. Stuck: CI red with no
fixer, a refused sync, a fixer's `blocked`, an acr answer with `verdict:
"failed"` or `"empty"`, a fixer answer whose `meta.result` is none of the
three, a permission card still open when next woken.

Every ask to `reply-to` carries `meta: { pr: <N>, repo: "<owner>/<repo>" }`;
never a post in its place.

## In a terminal

`{{skill:ship}}` prints the intake shape above and stops.
