# Jira and pull requests

The **Work** tab (left rail) lists your Jira tickets. The **PRs** tab (right rail) lists your
GitHub pull requests. Both refresh every 60 seconds; overscroll either list to refresh now.

**On this page:** [Connect Jira](#connect-jira) · [The Work tab](#the-work-tab) ·
[Start a session from a ticket](#start-a-session-from-a-ticket) · [The PRs tab](#the-prs-tab)

## Connect Jira

Until Jira is connected the Work tab says so and points you here.

1. Open **Settings › Integrations** and scroll to **JIRA**.
2. **Site**: the bare hostname, like `your-team.atlassian.net`. A pasted `https://` is trimmed.
3. **Account email**: the address you sign in to Jira with.
4. **API token**: create one at id.atlassian.com, paste it, then **Test connection**.

![Settings › Integrations: GitHub token source, gh status, and the Jira site](../assets/guide/16-settings-integrations.png)

The site and email live in `~/.hive/config.json`. The token does not: it is encrypted with
the macOS Keychain and never leaves the main process.

```json
"jira": {
  "site": "your-team.atlassian.net",
  "email": "you@example.com"
}
```

## The Work tab

<img src="../assets/guide/06-work-tab.png" alt="The Work tab: Jira tickets, each with its status, a new session link and its conversation" width="340">

By default it shows:

```text
assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC
```

Set **JQL override** in the same Settings band to change it. Your query **replaces** the
default; it is not added to it.

On each ticket you can move it through its workflow, read and add comments, and see the PRs
and sessions linked to it. Type in **Search tickets** to search every ticket, any assignee,
any status; tick **Mine only** to narrow it.

## The ticket page

In the round-two layout, **Work** is a place of its own. The panel lists your tickets in
three groups, **In progress**, **To do** and **Done** (Done starts folded; click a group's
header to fold or unfold it). The header counts the tickets and how many **need you**.

Each row is one line of title and one line of facts: the key, then the one thing that
matters most about the ticket right now, first match wins:

- `waiting on you`: a session on it is asking you something.
- `2 findings on #412`: a review left findings on its pull request.
- `builder · task 3 done`: an agent's latest progress on it.
- `session working`, `1 idle session`, or `no session`.

A status that differs from its group, like `In Review` inside In progress, leads the line.
The dot is amber when the ticket needs you, green while a session or an agent works it, and
an empty ring otherwise. The magnifier shows **Search tickets**; a search replaces the list.

Click a row and the ticket's page fills the stage:

- **The header**: the key (it opens Jira), the status pill (click it to move the ticket),
  the title, then the description.
- **Conversation**: Jira's newest 50 comments, oldest first. **Comments | Everything**
  switches between the comments alone and the comments with what the agents and sessions
  posted about the ticket, in time order. Hover a comment for **Reply** and **Copy link**.
  Reply addresses the box below to its author and starts the comment with an @mention of
  them, drawn as a chip above the box; **×** removes it, and Escape in an empty box forgets
  the reply and its chips. Reply on an agent's comment adds no chip, since that comment is
  yours in Jira. Type `@` and two characters to search everyone on the Jira site: ↑/↓ move,
  Enter picks a person into a chip, Esc closes the list. **Could not search Jira** means the
  search failed; the box still works. A comment may be mentions alone. The box posts to
  Jira, where everyone on the ticket sees it, and Jira notifies each person mentioned.
  A comment the Hive posted for an agent shows the agent's glyph, its name and **via the
  Hive**. That is a label, not proof: anyone who can edit the issue can set it.
- **Properties**, on the right: status, priority and side (read off a title's `[P4]` and
  `[BE]` tags when it has them), project, assignee, the agent on it and its epic; the
  sessions and pull requests on it; and the actions: **New session**, **Move to** the next
  status when there is one, and **Open in Jira**.

The page re-reads the ticket every minute while it is open. A read that fails says so in
its section with **Retry**, and what was already on screen stays, marked with its time.

## The Ticket tab

In round two, a session started from a ticket has a **Ticket** tab in the session panel,
so what was asked for sits beside what the session says it did. Top to bottom:

- **The header**: the key, the type and the status pill, then the title.
- **Acceptance criteria**: the list items under the description's "Acceptance" or
  "Acceptance criteria" heading. With no such list it shows the **Description** instead.
- **Latest comment**: the newest one, with its author and time.
- **Links**: a line of verdict, a drawing, and a row for each kind of link that opens its
  list. Click a ticket in a list, or in the drawing, to open it on the Work page.
- **The footer**: **Move to** the next status when there is one, and **Open the ticket ›**,
  which opens the ticket's page on Work.

The verdict is amber when something open blocks the ticket: `Blocked by 2 open: HIVE-188,
HIVE-190.` Otherwise it is green: `Clear to go.` then `Nothing blocks it`, `Its one blocker
is done` or `All 3 blockers are done`, and `; 1 ticket waits on it` or `; 4 tickets wait on
it` when others wait on this one.

The drawing, the constellation, puts the ticket in the middle of its epic's ring. What it
**waits on** is on the upper arc and what **waits on it** on the lower, one cell per ticket:
a check for done, a filled dot for in progress, an empty ring for to do, amber when it is
a blocker not done. Past six on an arc it shows five and a `+N`. Related tickets are beads
on the ring's left, labelled only up to three of them. The session's pull request is to the
right. Keys in the ticket's own project drop the prefix. The epic's name heads the ring,
with `done/total` when Jira can count its children. With five links or fewer, a ticket the
ticket blocks also shows the first ticket **it** blocks, one step further out.

"Blocks" means Jira's link type of that name, whatever its wording; every other type
(Relates, Duplicate) is a bead. A ticket with no links says `No linked tickets`.

The tab reads the ticket when it opens, and again every minute while it is the visible
tab. A failed read says so with **Retry**, and what was already shown stays.

## Start a session from a ticket

Click **new session** on a ticket. The picker opens with the ticket key filled in, because a
ticket does not say which repository it belongs to. Pick the project and press Enter.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/ticket-to-pr.dark.svg">
  <img src="../assets/diagrams/ticket-to-pr.light.svg" alt="A Jira ticket starts a session named for it; its branch becomes a pull request that links back to the session">
</picture>

The session is named for the ticket, and names stay unique: `ABC-123`, then `ABC-123-2`.
From here, [Working a ticket](workflow.md) walks the rest of the way to Done.

## The PRs tab

<img src="../assets/guide/07-prs-tab.png" alt="The PRs tab: an open pull request and two recent merges" width="340">

The list comes from the GitHub CLI, run as you, with two searches:

```text
is:pr author:@me is:open   sort:updated-desc
is:pr author:@me is:merged sort:updated-desc    (kept for 24 hours)
```

Each card links to GitHub and to the session whose branch made it. **Search pull requests**
filters the list. The Hive stores no GitHub token; `gh` uses its own login, or `GH_TOKEN` /
`GITHUB_TOKEN` if set.

If the tab stays empty, run `gh auth status`. **Settings › Integrations › Command line** shows
which `gh` The Hive found and who it is signed in as.

## What the agents are doing

When the workflow agents are on a piece of work, the cards say so. A ticket an agent is
working shows its newest progress under its title, named by the agent: `builder · task N done`,
`shipper · ci`, `fixer · fix`; a PR the shipper is shipping shows one
more badge, `shipping`, beside the GitHub ones. A draft without it is one nobody is driving.
Both are read off the ledger: the badge goes when the shipper releases its claim on the PR, the agent line when the ledger tail
rolls past it, and a ticket worked inline shows nothing extra. To look at what the
builder or the fixer has on disk, `term builder` in the console opens a terminal on
the worktree it last posted.
