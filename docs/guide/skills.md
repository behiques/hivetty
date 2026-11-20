# Custom skills

A skill is a slash command you write once and every Hive session gets. Skills live under
`~/.hivetty/skills` and reach **only** sessions HiveTTY starts, on any CLI, never a CLI you run
elsewhere.

**On this page:** [What a skill is](#what-a-skill-is) · [Create a skill](#create-a-skill) ·
[Import a skill](#import-a-skill) · [How skills reach a session](#how-skills-reach-a-session) ·
[Rules](#rules)

## What a skill is

A folder with a `SKILL.md` at its root, plus any files it needs.

```text
~/.hivetty/skills/
└── release-notes/
    ├── SKILL.md            # required: frontmatter + instructions
    ├── templates/
    │   └── notes.md
    └── scripts/
        └── collect.sh      # executable bit is kept
```

The folder name, the `name:` in the frontmatter and the command are one value: this skill
is `/release-notes`.

## Create a skill

**Settings › Skills › + New skill** opens a template with `name`, `description` and
`disable-model-invocation`. Filled in, it looks like this:

```markdown
---
name: standup
description: Summarise what this branch changed since yesterday
disable-model-invocation: true
---

List the commits on this branch since yesterday and summarise them in three bullets.
```

`disable-model-invocation: true` means the skill runs only when you type `/standup`; drop it
to let Claude pick the skill on its own.

![Settings › Skills with a skill's files on the left and SKILL.md open](../assets/guide/20-skill-editor.png)

Inside a skill: **New file**, **New folder**, **Add from your computer**, or drag files in.
Save with `⌘S`. Renaming `name:` renames the folder.

You can also just write the folder in your own editor. It is read again before every
spawn.

A skill may end with `/done handoff` to close its session when it finishes.

## Import a skill

**Import skill** takes a `.zip` (up to 100 MB) or a folder with `SKILL.md` at its root. The
skill is named by its frontmatter; a `SKILL.md` with no frontmatter or no `name` is refused.

## How skills reach a session

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/skills.dark.svg">
  <img src="../assets/diagrams/skills.light.svg" alt="Skill folders are read before every spawn into a generated plugin passed with --plugin-dir; claude started elsewhere is unchanged">
</picture>

A skill that fails validation shows in Settings with its reason and is not injected.

A session HiveTTY starts also loads your own Claude Code plugins, except the ones switched
off in **Settings › Skills › Manage Installed Plugins**; the row beside that button names the
ones that are off (or counts them, when the names would not fit). `workstream` and `superpowers` are
off by default, because their skills overlap HiveTTY's own: `workstream:work-on` beside
`hive:work-on` makes "work on HIVE-123" a coin toss. The switch only affects sessions the app
starts, from the next one on; `claude` started anywhere else still loads every plugin you
enabled. A hand edit of `disabledSessionPlugins` or a plugin installed while the app is open
reaches the next session too: the settings file is rewritten before every spawn. Agents load
none of your plugins either way.

### Skills in every CLI (HIVE-369)

HiveTTY renders each skill once for Claude Code, Codex and Copilot. Write a hive tool as
`{{tool:ledger_ask}}`, another skill as `{{skill:plan}}` and the skill's own folder as
`{{plugin_root}}`, and each CLI gets its own spelling. A skill with none of these reaches every
CLI exactly as you wrote it. When the file you are editing names something only one CLI
understands, such as `mcp__hive__ledger_ask` or `hive:plan`, Settings › Skills lists it under the
editor with its neutral form, and **Fix all** rewrites the file for you (unsaved, so you see the
change first). Saving is never blocked.

## Skills from swarms

Skills come in swarms: sets of agents and skills that install together and update when their
publisher releases a new version ([Swarms](swarms.md)). HiveTTY ships no skills of its own. The
**Dev Squad** swarm carries the ticket-to-merge workflow: `/work-on` and `/goal-on` at the
front, `/brainstorm`, `/plan`, `/execute`, `/tdd`, `/debug`, `/verify` and `/worktree` behind
them, and the PR tail: `/ship`, `/review-pr-findings`, `/merge-pr`, `/spec-deviation` and
`/pr-review`, the multi-agent review the reviewer agent runs. A new install starts with none of
them; an install that had the built-in skills keeps them, edits intact, as Dev Squad. Settings ›
Automation › Swarms installs, updates and removes swarms. With no skill installed at all, Settings › Skills says so
and offers **Install Dev Squad** and **Browse swarms**, as the Agents place and Home do for agents.

A swarm's skills live in `~/.hivetty/skills` and are ordinary skills once they are there. Edit one
in Settings and your edits stay, while an update still reaches what you did not touch: in
`SKILL.md`, each frontmatter key and the body update on their own, so changing one key does not
stop the body from updating. If you rewrote the body and a newer one arrives, Settings marks the
skill amber and holds the new body back until you choose to **Compare**, **Take shipped prompt** or
**Keep mine**. A blue dot means you changed something, and **Reset to shipped** puts the
swarm's files back. Other files in a skill update only if you never edited them. Delete a
skill and it stays deleted.

To get a deleted skill back, reinstall Dev Squad (or the swarm it came from) in Settings ›
Automation › Swarms; for a skill you edited, **Reset to shipped** puts its files back.

## Rules

| Rule | Detail |
| --- | --- |
| Name | lower-case letters, digits and dashes |
| Reserved | `done` belongs to the app |
| Size | up to 200 files, 5 MB per file, 4 folders deep |
| Skipped | symlinks and `.DS_Store` are listed but not copied |
| Remote | import is off while attached to a server |
