# Sessions and terminals

A **session** is a real agent CLI (Claude Code, Codex or Copilot) running in a real terminal
inside one of your projects. A **terminal** is the same thing without an agent: a plain login
shell.

**On this page:** [Start a session](#start-a-session) · [Pick the CLI](#pick-the-cli) · [Talk to it](#talk-to-it) ·
[Status](#status) · [Names and branches](#names-and-branches) ·
[Finish with /done](#finish-with-done) · [Resume](#resume) ·
[Session history](#session-history) · [Terminals](#terminals)

## Start a session

Four ways, same result:

| From | Do this |
| --- | --- |
| The Overmind | **New session**, type a project, **Enter** (filtered to a project: **New session in** it, straight away) |
| The Sessions panel | **+** on the project's line, shown on hover (uses the picker's last model and effort) |
| A Jira ticket | **New session** under the ticket page's Actions; the session is named for the ticket |
| The console | `spawn <project> <task>` (always Claude Code) |

![The picker: pinned projects, the CLI dock, model and effort, search](../assets/guide/02-new-session-picker.png)

Up to 24 sessions can run at once, on any mix of CLIs.

## Pick the CLI

The dock under the picker's title offers **Claude Code**, **Codex** and **Copilot**. A new
session starts on the first of these that applies:

1. the CLI you picked in the picker since the app started;
2. the project's own default (**Default CLI** in its ⋯ menu in Settings › Projects);
3. the global default (**Default** in Settings › Harnesses › Overview);
4. the first CLI that is available.

A CLI is unavailable when it is not installed, turned off for sessions, or not in your plan
(Codex needs Solo, Copilot needs Team). It shows dimmed with the reason, and the line under
the dock says when it was skipped: *Codex, the default for nova-web, isn't available ·
starting on Claude Code*. See [Settings › Overview](settings.md#overview).

Each CLI brings its own models and effort levels, which become flags on its command line:

| CLI | Models | Effort | Defaults |
| --- | --- | --- | --- |
| Claude Code | `haiku`, `sonnet`, `opus`, `fable` | `low`, `medium`, `high`, `max` (none for `haiku`) | `opus`, `high` |
| Codex | your account's models, read from Codex's own cache, picked by family | `low` to `max`, plus `ultra` where the model has it | the first model, `medium` |
| Copilot | `auto` and the models Copilot offers, in a list | `none` to `max` | `auto`, `medium` |

What differs once it runs:

| | Claude Code | Codex | Copilot |
| --- | --- | --- | --- |
| Header gauges | model, effort, context, 5-hour and 7-day limits | the same, plus credits | model, context, tokens, AI credits |
| Statuses ([below](#status)) | all | no idle notice, no MCP-input wait | no idle notice, no MCP-input wait |
| Resume | yes | yes | yes |
| HiveTTY skills, typed as | `/hive:<name>` | `$hive-<name>` | `/hive:hive-<name>` |
| Containers | yes | no | no |

## Talk to it

There is no separate message box. Keys go straight to the CLI's prompt, and the
terminal takes focus when it appears. While the shell boots, a cover hides the startup
noise until the CLI is ready.

To type into a session without opening it, use the console:

```text
overmind ❯ send sess-03 run the tests again
routed → sess-03
```

## Status

Every session shows a coloured dot and a word.

| Label | Means | Your move |
| --- | --- | --- |
| **working** | a turn is in progress | wait |
| **needs input** | blocked on a permission prompt or a question | answer it; an inbox card is waiting |
| **idle** | the turn is over and nothing is running | your turn |
| **working (agents)** | the turn finished but a subagent is still running (Claude Code only) | wait |
| **working (scripts)** | a background shell is still running | wait, or carry on |
| **idle (shipper)** | the turn is over, and an agent it asked (`ledger_ask`) is still on the job: named when its name is 10 characters or fewer, else **idle (agents)**, or **idle (2 agents)** for more | wait; hover for every agent, and who each brought in |
| **done** | ended on purpose (`/done`, `/clear`, or the app closed) | resume it if you want |
| **terminated** | the process is gone (`/exit`, `Ctrl+D`, a crash) | read the scrollback |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/session-status.dark.svg">
  <img src="../assets/diagrams/session-status.light.svg" alt="Session status: working, needs input, idle, done and terminated, and what moves a session between them">
</picture>

Status comes from each CLI's own hooks, so "needs input" is exact rather than guessed. Codex
and Copilot report fewer events than Claude Code: neither sends an idle notice (the end of a
turn is the signal) or a wait for an MCP server's input, and neither reports a declined
prompt, so HiveTTY clears that card on your next keystroke. Copilot raises a permission card
only when it actually draws a prompt; calls you already approved raise none. Codex in a
repository with its own `.codex` folder reports nothing until you trust HiveTTY's hooks
there. The agents come from the ledger: an ask from the session to an agent stays open until the job closes, and only the agents the session asked itself are named. While one is on the job, the session is not yours again yet, so "is yours again" and "runs out of instructions" wait until it closes.

## Names and branches

- Every session gets an id like `sess-07` that never changes.
- Claude titles the session from its conversation. HiveTTY tidies that into a short
  hyphenated name, at most four words.
- A ticket key always leads the name. Typing `work on ABC-123` links the session to
  that Jira issue once Jira confirms it exists:
  `back key interception abc-123` becomes `ABC-123-back-key-interception`.
- The console and the lists accept either the id or the name, in any case.
- The branch is whatever git reports in the session's folder. A dash means none has been
  seen yet.

## Finish with /done

Type `/done` in a session (`$hive-done` in Codex, `/hive:hive-done` in Copilot). HiveTTY marks
it done and closes its terminal when the turn ends. The row stays under **ENDED** and is still
readable.

`done` is a skill HiveTTY adds to every session it starts, on every CLI. Your own skills can end with
it too ([Custom skills](skills.md)). If the app cannot be reached, the skill tells you to
type `/exit` instead.

## Resume

Rows ended by `/done` or by quitting the app show a **resume** button in the fleet table.
It restarts the same CLI on the same conversation (`claude --resume`, `codex resume`, or
Copilot by its pinned id) and moves the row back up. A row
ended by `/clear` cannot be resumed: its terminal already carried on as a new session.

## Session history

The 20 most recent ended sessions survive a restart. They come back under ENDED, newest
first. The column **LAST USED** is when each one ended or last resumed.

## The Sessions place

The **Sessions** icon on the bar opens the Sessions panel beside the overmind.

- The head reads **Projects**, then how many sessions and terminals are live and how many
  need you. **+** adds a project.
- **All projects** shows the whole fleet in the overmind.
- Each project starts folded. Folded, a badge on its icon counts what is inside: amber for
  sessions waiting on you, else green for everything live. With nothing live it shows
  nothing.
- Click a project's **name** to filter the overmind to it; that also unfolds it. The
  caret beside it only folds and unfolds.
- Unfolded, each session is one line under a comb — filled while it works, hollow when
  idle — then the project's terminals.
- Hover a project's line for **+** (new session) and **>_** (terminal); the counts give
  way to them.
- Opening a session unfolds its project. Coming back with the back button, `⌘[` or the
  Sessions icon keeps the filter you left and puts the selection on the session you were
  in.
- Leave Sessions for another place and the Sessions icon brings you back to the session
  you had open, or to the overmind if you had none or it has since ended.
- The session header over the terminal carries the model and its usage gauges; a plain
  terminal's has none.

### The session header

The session header sits over a session's terminal:

- **‹ Overmind** goes back to the overmind, as `⌘[` does, with the selection on this
  session.
- The session's name, with its task as the tooltip, over `project · branch`.
- Its status, then a space reserved for the model.
- **⋯** holds **Terminal here** and, when the session has one, **Open PR #N**.

A terminal gets the same header: its name over `project · folder`, and its state. It has
no model and no menu.

### When a session ends

A session you end while looking at it (`/exit`, `/done`) takes you back to the overmind,
with the selection on its row. `/clear` does not, because its terminal carries on as a new
session. A session that ends without being asked (killed by a signal, or the pty host
crashing) keeps you there, so its card can say what happened.

An ended session's row can't be opened; **Resume** on the row picks it back up when it can.
When a session is killed or crashes in front of you, or ends while you are in its editor,
its header's status reads **Ended**, with the reason as its tooltip, and a card covers the
terminal: **This session ended**, why, and how long ago. When the conversation can be picked
up it adds that its transcript is on disk, and **Resume**. **‹ Overmind** is always there.
✕ closes the card to a strip along the foot, with the reason, Resume and Overmind, so you
can read the scrollback above it. Closing is per session and forgotten on restart.

### A narrow window

Under 1,200px wide the list panel floats over the stage instead of sitting beside it, and
starts closed. The bar icon opens it; picking a row, clicking beside it or Esc closes it.

## Terminals

A terminal is a login shell in a project with no agent CLI in it: no hooks, no cost, no
history, no resume. Its status is **at prompt** or the name of the program running in it,
like `vitest` or `vim`.

| Open one from | How |
| --- | --- |
| The Sessions panel | **Terminal** under an unfolded project |
| A session | **Terminal here** in its session header's **⋯** menu, or ``Ctrl+` `` |
| The console | `term hive`, or `term` for beside the selected row |

A shell that exits normally disappears. One that dies shows why, with a **Close** button.
