# Swarms

A swarm is a set of agents and skills that install together and update when their publisher releases a new
version. HiveTTY publishes some, your organization can publish its own, and anyone can publish a community
swarm. Swarms are part of HiveTTY Pro, and everything a swarm installs is saved under `~/.hivetty`, beside your
own agents and skills.

HiveTTY itself ships no agents and no skills. **Dev Squad**, the ticket-to-merge workflow, is a swarm: a new
install starts empty and offers **Install Dev Squad**. An install that had the built-in agents and skills keeps
them, with your edits, as the installed Dev Squad. It reads "Bundled" until its first update, and until then
shows no per-file edits.

**On this page:** [Find a swarm](#find-a-swarm) · [What you agree to](#what-you-agree-to) ·
[Your installed swarms](#your-installed-swarms) · [Updates](#updates) · [Files you edited](#files-you-edited) ·
[Remove a swarm](#remove-a-swarm) · [Install from a link](#install-from-a-link) ·
[The update notification](#the-update-notification)

## Find a swarm

Open **Settings › Automation › Swarms** and choose **Browse swarms**. You need to be signed in: signed out,
Browse asks you to sign in first.

Swarms are grouped as **Native** (published by HiveTTY), one group for each organization you belong to, and
**Community**. Each shows its publisher and how many agents and skills it has. The search box matches a
swarm's title, publisher and description, and the names of its agents and skills, so you can search for the
agent you want rather than the swarm it comes in.

Choose **Installed swarms** to go back to the list.

## What you agree to

Nothing installs until you have seen what it brings. **Install** opens a dialog listing every agent in the
swarm, with its description and the tools it may use, and every skill. Agents in a swarm run on your Mac with
the tools listed there, so read the list before you choose **Install**. **Cancel** installs nothing.

The dialog comes back whenever something you have not seen could arrive:

- before every install of a swarm you do not have, including **Try again** after an install failed (the
  publisher may have released a new version since);
- before every update of a community swarm. For an update the dialog starts with **What changes**: agents and
  skills added or removed, and tools added to or taken from an agent. Then it lists the new version whole.

Native and organization swarms update without the dialog. Their publishers are HiveTTY and your organization.

## Your installed swarms

Each installed swarm is a row with its title, a tag (Native, your organization's name, or Community), the
publisher and the counts. The dot and the line beside it say where it stands:

| The row reads | What it means | What you can do |
| --- | --- | --- |
| `v1.4.0 · up to date` | The newest version is installed | Nothing to do |
| `v0.9.2 · v0.10.0 is ready` | A native or organization update is waiting | **Update now** |
| `v2.1.0 · v2.2.0 available` | A community update is waiting for you to review it | **Review update** |
| `Updating…` | An install or update is running | Wait |
| `v1.0.0 · update failed` | The last update failed; the installed version still works | **Update now** or **Review update** tries again |
| `Not installed` | The first install failed; the message says why | **Try again**, or **Dismiss** to forget it |
| No longer available | The swarm left the registry, or your organization withdrew it. It stays installed and won't update | **Remove** |

**Check for updates** looks for new versions now, instead of waiting for the next automatic check. When an
update is applied, the line beside the buttons says so: "Dev Squad updated to v1.4.0".

## Updates

HiveTTY checks every six hours, when you sign in, and when you choose **Check for updates**.

**Update automatically** is a switch on each row. It starts on for native and organization swarms and off for
community swarms, and you can change it either way. With it on, an update installs as soon as it is found. With
it off, the row shows the update and waits for you.

A community swarm never updates without you, even with the switch on: every community update waits on its
**Review update** dialog.

An organization can pin its swarm to a version. A pinned row shows "Pinned to v1.2.0 by Acme" instead of the
switch, and installs that version whatever the switch said.

An automatic update waits while any agent is running, so an agent's files never change in the middle of a run.
It installs once the last run ends. **Update now** and **Review update** don't wait: a click installs at once.

## Files you edited

Editing an agent or a skill that a swarm installed is fine. An update replaces only files you have not touched,
and keeps your edited copy of the rest. The row then shows "1 file kept as you edited it". Open it to see each
file with two choices:

- **Take shipped prompt** replaces your copy with the swarm's new one.
- **Keep mine** keeps your copy.

## Remove a swarm

Choose **Remove** on the row and confirm. The swarm's agents and skills go, except files you edited, which
stay where they are. If the swarm cannot be removed, the reason appears under its row.

Installing it again later starts fresh, with **Update automatically** back at its default.

## Install from a link

The HiveTTY website can link straight to a swarm: `hivetty://swarms/install?id=…`. Opening one brings HiveTTY
forward on **Settings › Swarms** with that swarm's install dialog open. A link never installs anything by
itself: you still read the dialog and choose **Install**.

- Signed out, the pane says "Sign in to install this swarm." Sign in, and the dialog opens.
- A swarm your account cannot see reads "This swarm isn't available to your account."
- A swarm you already have is left as it is: no dialog opens, and the pane shows your list with its row.

## The update notification

When a swarm updates itself, with nobody clicking, HiveTTY raises a notification: "Dev Squad updated to v1.4.0".
Turn it off, or choose where it appears, under **Settings › Notifications**, "When a swarm updates itself".
Updates you start yourself raise no notification.
