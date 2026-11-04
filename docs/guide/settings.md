# Settings

Open Settings with the gear at the foot of the bar. Nine sections, top to bottom. Almost everything
here is written to `~/.hivetty/config.json` ([The config file](configuration.md)); appearance
and editor preferences stay on this machine.

**On this page:** [Projects](#projects) · [Runtime](#runtime) · [Skills](#skills) ·
[Agents](#agents) · [Appearance](#appearance) · [Editor](#editor) ·
[Integrations](#integrations) · [Notifications](#notifications) · [Advanced](#advanced)

| Where it is stored | What |
| --- | --- |
| `~/.hivetty/config.json` | projects, runtime, Jira site and email, notifications, Slack, server and remote |
| Encrypted with the Keychain, in the app's data folder | the Jira API token, the Slack tokens, the remote device token |
| `~/.hivetty/skills/`, `~/.hivetty/agents/` | skills and agents |
| This machine only | appearance and editor preferences |

## Projects

Add a folder, **Clone from URL**, rename, re-point, reorder, remove, and edit each project's
two-to-four letter key. When cloning, the URL field lists your GitHub repositories (the ten
most recently pushed, filtered as you type, through `gh`); pick one, or paste any git URL.

![Settings › Projects](../assets/guide/11-settings-projects.png)

## Runtime

What a session spawns. **Shell** (started as a login shell) and **Agent command**
(default `claude`) for every project, plus environment variables. **Per-project overrides**
change any of these for one project. **Import my login shell's PATH at startup** lets a
Finder-launched app find Homebrew tools. Two diagnostics explain why `claude` was or was not
found, and which variables your rc file overrode.

![Settings › Runtime](../assets/guide/18-settings-runtime.png)

**Example.** Point one project at a wrapper script:

```json
{ "id": "nova-web", "path": "~/repos/nova-web", "claudeCommand": "~/bin/claude-nova" }
```

## Overview

Settings › Harnesses › Overview lists Claude Code, Codex and Copilot. Each row shows the binary HiveTTY found on
this Mac, or on the server you are attached to, and its version. A CLI that is not there shows why, with the line
that installs it. **Rescan** looks again after you install one. **Use for sessions** takes a CLI out of the new-session
picker, though at least one stays on. **Default** is the CLI a new session starts with; the picker remembers what you
last picked until the app restarts. A CLI that is missing or turned off shows dimmed in the picker, with the reason.
A Claude command that needs a shell to read, such as `$HOME/bin/claude` or `env FOO=1 claude`, can't be checked: the
row says so and Claude Code stays in the picker.

**Example.** Start new sessions on Codex, and keep Copilot out of the picker:

```json
"sessionsDefaultCli": "codex",
"clis": { "copilot": { "sessions": false } }
```

### Headless agents

How each agent CLI runs [agents](agents.md). Claude Code's **Headless agents** group has
**Enabled for agents**, and a default **Model** and **Effort** for agent runs. An agent's own
`model:` or `effort:` in its `AGENT.md` wins; **CLI default** leaves the flag off so the CLI
picks. Turn a CLI off and agents skip it; with no other CLI enabled, they refuse to run and
their row says why.

**Example.** Run agents on Haiku unless they ask for something else:

```json
"clis": { "claude-code": { "agents": { "enabled": true, "model": "haiku" } } }
```

## Skills

Create, import and edit [custom skills](skills.md).

![Settings › Skills](../assets/guide/14-settings-skills.png)

## Agents

Create and edit [agents](agents.md) with a form or as source.

![Settings › Agents](../assets/guide/15-settings-agents.png)

## Appearance

Mode (System, Dark or Light; the bar's sun or moon flips it too), [themes](themes.md), terminal font, size and scrollback, team name
(shown at the right of Home's headline), density.

## Editor

Placement (Full stage or Split), split direction, Tabs or One at a time, **Markdown** (opens
in Preview or Source), **Allow editing**, font, size, tab width, wrapping, line numbers. See [Files and the editor](explorer.md).

## Integrations

GitHub (which token `gh` would use, and where `gh` is), Jira (site, email, API token, JQL
override) and Slack (sign-in, Socket Mode). See [Jira and pull requests](work-and-prs.md)
and [Slack](slack.md).

![Settings › Integrations](../assets/guide/16-settings-integrations.png)

## Notifications

One row per event: Off, Inbox or Both. See [The inbox](inbox.md#choosing-what-reaches-you).

## Advanced

- **Config file**: its path, **Reveal in Finder**, **Reload**. The file is not watched: edit
  it by hand, then Reload. Reload also picks up skills and agents edited under `~/.hivetty`, so
  the next session and agent run use them. A running session keeps what it started with, and
  the few fields read only at launch (receiver bind, server mode and bind, login environment,
  remote attach) are named under the button as needing a restart.
- **Containers**: the host alias, and **Accept connections off loopback**
  ([Containers](containers.md)).
- **Server mode**: **Serve this machine**, **Attach to a server**, paired devices
  ([Remote](remote.md)).
- **Reset to template**, **About** (versions), **Updates › Check now**, **Diagnostics**.

![Settings › Advanced](../assets/guide/19-settings-advanced.png)
