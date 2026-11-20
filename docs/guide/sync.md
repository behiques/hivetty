# Settings sync

Sync keeps your setup the same on every Mac you sign in to: harness settings, your own skills and agents,
and how the app looks. It is part of HiveTTY Pro, and it is encrypted with a passphrase only you know.

**On this page:** [What syncs](#what-syncs) · [Turn it on](#turn-it-on) ·
[Join from another Mac](#join-from-another-mac) · [When two Macs change the same thing](#when-two-macs-change-the-same-thing) ·
[The skills and agents the app ships](#the-skills-and-agents-the-app-ships) · [Reset sync](#reset-sync)

## What syncs

Open **Settings › Account › Sync**. Three switches decide what this Mac sends and takes. Each Mac sets its own
switches, so a Mac can sit out one group while the others keep syncing it.

| Switch | What it carries |
| --- | --- |
| **Harnesses** | The Claude Code command; the Codex and Copilot commands; for each CLI, whether sessions use it and its model and effort; each CLI's agent settings (on or off, model, effort, the Codex sandbox, the Copilot deny list); the default CLI for agents and for sessions |
| **Automation** | Your skills and agents under the hive folder, and the ticket workflow |
| **Appearance & preferences** | Theme, your theme library, density, the terminal and editor fonts and sizes, word wrap, line numbers, tab width, notification preferences and your Jira query |

These never leave the Mac: your projects, environment variables, tokens and other credentials, server and
remote settings, Slack, the Jira site and email, panel widths and split sizes, each CLI's setting for
skipping permission prompts, and Codex agents' network access and project git access. A Mac starts
skipping prompts, or widens the Codex sandbox, only when you turn that on there.

## Turn it on

On the first Mac, type a passphrase twice and choose **Turn on sync**. It needs at least 12 characters.

The passphrase never leaves the Mac and is never stored. Each Mac keeps a key made from it, sealed in the
macOS keychain, so you type it once per Mac. HiveTTY's servers only ever hold an encrypted copy they cannot
read.

Keep the passphrase somewhere safe. It can't be recovered. If you forget it, [Reset sync](#reset-sync) starts
over from one Mac.

## Join from another Mac

Sign in to the same account on the second Mac and open **Settings › Account › Sync**. It says **This account
already syncs**. Type the passphrase and choose **Join sync**.

When a Mac joins:

- What only this Mac has is kept, and sent to your other Macs.
- Where this Mac and the synced copy differ, the synced copy wins.
- This Mac's differing copy is kept in the conflicts folder, so nothing is lost.

From then on, a change syncs a few seconds after you make it, every 5 minutes, when you bring a window to the
front, and whenever you choose **Sync now**.

## When two Macs change the same thing

Each setting and each file is compared on its own. If two Macs change the same one before they sync, the newer
change wins on both, and the other version is kept in the conflicts folder beside your config file, under
`sync-conflicts/`. A file keeps its path there; settings go into a `settings.json` in the same folder.

The Sync tab counts what is kept and names the latest. **Open folder** shows it in Finder. Delete what you no
longer need; sync never deletes it for you.

A file deleted on one Mac is deleted on the others, unless another Mac edited it in the meantime: then the edit
wins.

## The skills and agents the app ships

HiveTTY puts its own skills and agents in your hive folder and updates them with the app. A shipped file you
have not touched never syncs: each Mac keeps the version that came with its own build, so a Mac on an older
release never overwrites a newer one's.

A shipped file you edit syncs like any of your own. If you reset it to shipped on one Mac, your other Macs put
back the shipped copy of their own build.

## Reset sync

**Reset sync** deletes the synced copy for every Mac and forgets this Mac's key. Files on your Macs stay as they
are. Then set a new passphrase on this Mac, and join again from the others with it.

Your other Macs notice on their next sync and say **Sync was reset on another Mac. Enter the new passphrase to
sync again.**

Signing out of HiveTTY on a Mac turns sync off there and forgets its key. The conflicts folder stays.
