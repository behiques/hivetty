# The plan panel

While a session works through a plan, a slim rail beside its terminal shows the
tasks and how far along they are. Its session row carries the same count.

**On this page:** [What it shows](#what-it-shows) ·
[Where the tasks come from](#where-the-tasks-come-from) ·
[When it appears and leaves](#when-it-appears-and-leaves) ·
[The count on the session row](#the-count-on-the-session-row) ·
[In round two](#in-round-two) ·
[Turn it off](#turn-it-off)

## What it shows

A 34px rail at the terminal's right edge:

| Part | Means |
| --- | --- |
| `3/7` at the top | tasks done, out of all of them |
| A numbered ring | a task not started yet |
| A green ring, pulsing | the task Claude is on now |
| A filled green check | a task that is done |
| `✓` at the top | every task is done |

**Peek:** hover over the rail, or tab to it, and a drawer slides out over the
terminal with every task by name. A long name is cut short; hover it to read the
whole thing. Peeking never resizes the terminal, so nothing in it reflows.

**Pin:** the pin button in the drawer's header docks the drawer beside the
terminal for good. The terminal narrows once to make room. Unpin with the same
button. The choice is remembered.

## Where the tasks come from

A session has one plan at a time. When more than one source offers one, the
higher one in this list wins:

1. **Claude's own task list.** When Claude breaks work into tasks with its task
   tools, those tasks are the plan, ticked as Claude works through them.
   A subagent's tasks are left out.
2. **A `hive:plan` file.** When the session writes or edits a plan in its
   repository's `.hive/plans/` folder, the plan's tasks show up. `hive:work-on`
   and `hive:goal-on` both write one, so their sessions always have a plan.
   The file must sit under the folder the session is working in. A builder
   agent working that plan ticks them off through the ledger as it goes:
   in progress when it starts a task, done when the task's commit lands.
3. **Plan mode.** When you approve Claude's plan in plan mode, its steps show
   up as proposed tasks, none started, until one of the sources above takes
   over.

## When it appears and leaves

The rail appears as soon as the session's plan has a task, and only in that
session's terminal view. When every task is done the count turns to `✓`, and a
few seconds later the rail leaves. It also leaves whenever the conversation ends:
`/clear`, `/done`, a plain `/exit`, a crash or a kill, a restart, or the terminal
closing.

## The count on the session row

The same `done/total` sits in green after the session's status, both in the
Projects rail and in the overmind's fleet table. You can see how far a
background session has got without opening it.

## In round two

With **Settings › Appearance › Layout** on round two, the rail is replaced by the
session panel at the window's right edge. Closed, it is a 46px strip: the same
rings and `3/7` on top, then an icon for each other tab. Click any of them, or
press the right-rail chord, to open the panel. Under 1,200px wide it stays a strip.

The **Plan** tab lists every task. The one Claude is on shows its present-tense
wording ("Pushing the branch") under the title. Each task shows how long it ran,
or has been running, and the header adds up the total. Times start when a task
first goes in progress, so rewriting the list does not reset them.

A session started from a ticket also has a **Ticket** tab, between Plan and Files: the
ticket's criteria, its latest comment and its links. See [The Ticket
tab](work-and-prs.md#the-ticket-tab).

**Where it came from** appears when the session has written a `hive:plan` file.
It names the file and the time it was written; click it to open the plan in the
editor. The file stays there after the tasks move on to Claude's own list, and
goes when the session ends.

## Turn it off

**Settings › Appearance › Plan panel › Show plan panel.** Off hides the rail
beside the terminal. The count on the session row stays, since it takes no
room from the terminal. The setting applies to Classic only: round two's panel
is closed with its own button, and remembers whether it was open.
