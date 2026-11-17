# Server mode and remote attach

Run HiveTTY on an always-on Mac and drive its sessions from your laptop. The
sessions, agents, ledger and inbox all live on the server; the laptop is a window onto them.

This page is the overview. The step-by-step runbook is [Server mode](../server-mode.md).

**On this page:** [How it fits together](#how-it-fits-together) ·
[Serve from an always-on Mac](#serve-from-an-always-on-mac) · [Pair a device](#pair-a-device) ·
[Attach from a laptop](#attach-from-a-laptop) · [When the connection drops](#when-the-connection-drops) ·
[What a remote device cannot do](#what-a-remote-device-cannot-do)

## How it fits together

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/remote-topology.dark.svg">
  <img src="../assets/diagrams/remote-topology.light.svg" alt="A server Mac holds sessions, agents and the ledger; laptops attach to its listener over the local network or Tailscale, through an encrypted channel">
</picture>

Same version on both ends, and a private network between them: the same local network, or one
Tailscale tailnet to attach from anywhere. Every attach runs inside an end-to-end encrypted
channel keyed by the device's pairing secret; device tokens decide who gets in.

## Serve from an always-on Mac

Short version (the runbook has every command):

1. Keep the server Mac awake and logged in: automatic login, `pmset` sleep off, and, if you use
   Tailscale, key expiry off.
2. Add a `server` block to its config with the server's local-network or Tailscale address:

```json
"server": {
  "enabled": true,
  "bind": { "host": "100.101.102.103", "port": 7434, "allowedOrigins": [] }
}
```

3. Start it at login with a LaunchAgent, so it restarts itself and after updates.

`0.0.0.0` and public addresses are refused on purpose: bind the server's local-network or Tailscale
address. Every attach is end-to-end encrypted, so Tailscale is needed only to attach from outside the
server's local network. **Serve this machine** in
**Settings › Server mode** edits the same block.

## Pair a device

On the server, over SSH:

```sh
hivetty --pair "MacBook"     # prints a one-time token and a device id
hivetty --devices            # list paired devices
hivetty --revoke "MacBook"   # cut a device off
```

Pairing works while the server runs, with no restart. Only a hash of each token is kept in
the config.

## Attach from a laptop

**Settings › Server mode › Attach to a server**: enter the server address, port, device id and
token, then **Attach**. The token is stored encrypted (via the Keychain) in `remote-credential.bin`, in the app's data folder.

You cannot attach while sessions are running locally; the refusal lists them. The address must be
loopback, on your local network, or a Tailscale address; a server anywhere else is reached through the
relay. A server on an older HiveTTY is named as one: update it. A wrong token ends the attach with
"Pair again".

## When the connection drops

The connection item at the bar's foot turns amber and the laptop redials after 1, 2, 4, 8, 15 and 30 seconds, then
every 30 seconds, forever. Terminals pick up where they left off. **Work locally** is the way
out. A revoked token or a version mismatch is shown in red and not retried.

A line across the top of every stage says so too: **Lost HiveTTY on mini.
Reconnecting in 4s. The sessions keep running there.** It counts down to the next redial, and
**Try now** dials at once and starts the backoff again from its first step. Once the laptop is
back the line goes; when the link is given up it turns red and gives the reason, with no Try now.

Nothing typed or clicked while the link is down is queued. Each one is counted instead: "3
actions (clicks or keystrokes) did not reach mini; redo them once it is back." The count stays
through the reattach, because that is when you redo them. **Clear** dismisses it, and the count is
shared: Clear on the stage line or in the connection item's popover clears both.
Going local resets it.

## What a remote device cannot do

Pairing grants everything a local user can do, except things tied to one machine's window or
process: native folder pickers (use drag and drop), importing a skill from disk, revealing the
config in Finder, update checks, and pairing other devices. Settings edits the server's config,
and says so.
