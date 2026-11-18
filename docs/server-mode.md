# Server mode

HiveTTY can run on an always-on Mac and hold the sessions, the agents, the
ledger and the hook receiver there. The desktop app on any other machine
attaches to it and becomes a window onto it, from home or from a hotel four
time zones away.

One binary, two modes. The server Mac runs the same app with a `server` block
in its config; it opens no window, shows a menu-bar item, and listens on a WebSocket
bound to an address on its local network or its tailnet. The laptop runs the same
app with a `remote` block and routes every IPC call to that socket instead of to
its own process. Every attach runs inside an end-to-end encrypted channel, keyed
by a fresh X25519 exchange and the device's pairing secret.

This document takes a Mac from fresh out of the box to attachable, and to a server that
survives a reboot with nobody touching it. Follow it top to bottom once. After
that the machine looks after itself.

> **TL;DR**
> - One binary: a `server` block makes a Mac serve on a local-network or Tailscale address;
>   a `remote` block makes a laptop a window onto it.
> - Every attach is end-to-end encrypted. Tailscale is optional: you need it only to attach
>   from outside the server's local network.
> - It needs automatic login plus a LaunchAgent (the Keychain) and `pmset autorestart`;
>   with Tailscale, key expiry off.
> - `hivetty --pair`, `--devices` and `--revoke` manage device tokens; only hashes are stored.
> - `hivetty --login` and `--logout` sign the server in and out of HiveTTY over SSH, with a code.
> - The hook receiver stays on loopback. The server never binds a public address.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/diagrams/fd-server.dark.svg">
  <img src="assets/diagrams/fd-server.light.svg" alt="The attached client link states">
</picture>

**On this page:** [Before you start](#before-you-start) ·
[The keychain requirement](#the-keychain-requirement) ·
[1. Prepare the server](#1-prepare-the-server) ·
[2. Write the server block](#2-write-the-server-block) ·
[3. Start it at login](#3-start-it-at-login-keep-it-running) ·
[4. Pair each client](#4-pair-each-client) ·
[Sign the server in](#sign-the-server-in) ·
[5. Check it survives a reboot](#5-check-it-survives-a-reboot) ·
[Updates](#updates) ·
[What an attached device can do](#what-an-attached-device-can-do) ·
[Reaching it from anywhere](#reaching-it-from-anywhere) ·
[Exposure](#exposure) · [Troubleshooting](#troubleshooting)

## Before you start

- **The same version on both ends.** The attach frame carries
  `REMOTE_PROTOCOL_VERSION` (`shared/remote-contract.ts`). A mismatch
  is refused with a message naming both versions and which side to update. A
  client or server from before the encrypted channel (protocol 44 and older)
  cannot speak to this one at all: an old client is told, in one plain-text
  frame, to update; a new client attaching to an old server says the server is
  on an older HiveTTY.
  `scripts/remote-protocol.lock.json` pins the channel set to that version, so
  `pnpm verify:boundaries` fails a channel change that did not bump it.
- **A private network between the two.** The same local network is enough. To
  attach from anywhere else, put the server and every client in one Tailscale
  tailnet. See [Reaching it from anywhere](#reaching-it-from-anywhere).
- **Claude Code installed and logged in on the server.** Sessions run there, so
  `claude` has to work in the server's own shell.
- **Measure the floor first.** `ssh` into the server from wherever
  "remote" actually means for you, and type. Echo in an attached terminal costs
  one round trip over the same link; nothing in this design beats that.

## The keychain requirement

**The server must run inside a logged-in GUI session whose login keychain is
unlocked.** This is a requirement of the deployment, chosen on purpose, not a
bug to work around.

Electron's `safeStorage` encrypts every credential the app keeps (Jira, Slack,
anything else stored through it) with a key held in the login keychain. Outside
a logged-in session, or with that keychain locked, `safeStorage` reports
encryption unavailable and every stored credential is unreadable. A
LaunchDaemon, a process started at the login window, or one started over SSH
before anyone logged in all hit exactly that. The design chose auto-login plus
a LaunchAgent over writing a second secret store; if the server ever has to run
as a true daemon (a Linux box, say), this is the decision to revisit first.

The paired-device tokens are not affected: the server stores only a SHA-256
digest of each, in the config file, and needs no keychain to check one.

## 1. Prepare the server

1. **Install HiveTTY** from the dmg into `/Applications`, and open it once from
   Finder so Gatekeeper records it. Quit it again; launchd starts it from step 4
   on. Use a Developer ID signed build if you want the server to update itself
   (see [Updates](#updates)).
2. **Turn on automatic login.** System Settings, Users & Groups, *Automatically
   log in as*, pick the account that will run the server. macOS refuses this
   while FileVault is on, so FileVault has to be off: that is the cost of an
   unattended boot, and the reason the private-network bind and the device
   tokens matter.
   Automatic login unlocks the login keychain as long as the keychain password
   is still the account password; if you ever changed one without the other,
   fix that now (Keychain Access, *Change Password for Keychain "login"*).
3. **Keep it awake and bring it back after a power cut.**

   ```sh
   sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1
   ```

   The app also holds its own sleep assertion while serving
   (`powerSaveBlocker`'s `prevent-app-suspension`, the same thing
   `caffeinate -i` does), so this line covers the minutes before it starts and
   any time it is not running. `autorestart 1` is the one that matters for a
   power cut: without it the server Mac stays off until someone presses the button.
4. **Pick the address clients will dial.** On one local network, that is the
   server's LAN address:

   ```sh
   ipconfig getifaddr en0
   ```

   To attach from outside that network, **install Tailscale, log in, and let it
   launch at login**, then read the server's tailnet address instead:

   ```sh
   /Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4
   ```

   In the Tailscale admin console, **disable key expiry** for the server Mac, or it
   drops off the tailnet when its node key expires and every client with it.
   Give a LAN server a fixed address (a DHCP reservation on the router), or a
   client's saved address goes stale the next time the lease changes.
5. **Install the `hivetty` command**, so the one-shot commands below work over
   SSH:

   ```sh
   sudo mkdir -p /usr/local/bin
   sudo tee /usr/local/bin/hivetty >/dev/null <<'EOF'
   #!/bin/sh
   exec "/Applications/HiveTTY Pro.app/Contents/MacOS/HiveTTY Pro" "$@"
   EOF
   sudo chmod 755 /usr/local/bin/hivetty
   ```

   `/usr/local/bin` is on the default `PATH` of a macOS login shell, including
   an SSH one.

## 2. Write the server block

In the server's `~/.hivetty/config.json` (or in Settings, Machines, Server mode, *Serve this
machine*, from a screen-sharing session):

```json
"server": {
  "enabled": true,
  "bind": { "host": "100.101.102.103", "port": 7434, "allowedOrigins": [] },
  "devices": []
}
```

- **`enabled: true`** is what makes a plain launch serve. The LaunchAgent below
  passes no flag. `hivetty --server` serves for one run without writing the
  file, which is for trying it out, not for the deployment. A `--server` run
  does not update itself either: only `enabled: true` means launchd is behind
  the process.
- **`bind.host`** is the address from step 4: a private IPv4 address
  (`10.x`, `172.16.x` to `172.31.x`, `192.168.x`, `169.254.x`), a `.local`
  name, a Tailscale address (`100.64.0.0/10` or a `*.ts.net` name), or
  loopback so the link can be tried on one machine. A public address is
  refused, and so is `0.0.0.0` in every spelling (`0`, `0x0`,
  `000.000.000.000` included). IPv4 only. Prefer the literal to a name: a
  `.local` or `.ts.net` name is resolved by the OS when the server binds, and
  the literal is what you meant. A refused or malformed
  host does not stop the app, and it does not quietly bind loopback either:
  the server listens nowhere, the menu reads *Not serving* with the reason,
  and the log says the same once. Fix the block and restart the agent.
- **Clients must dial the exact string in `bind.host`.** The listener's Host
  guard admits loopback and that one value, nothing else. A MagicDNS name that
  resolves to the same address is refused with a bare 403, and the server's log
  says which name it refused and what it would have admitted. Bind the `100.x`
  literal and have clients use the literal. A `.ts.net` name works too, if both
  sides use the name.
- **`port`** is fixed, never OS-assigned: clients and the LaunchAgent have to
  know it ahead of time. 7434 is the default.
- **`allowedOrigins`** stays empty. The desktop client sends no `Origin`; a
  listed one exists only for a browser page someone points at the socket on
  purpose.

`CONFIG_VERSION` stays 2. An older build reads a file with a `server` block,
reports the key, and keeps it.

## 3. Start it at login, keep it running

A LaunchAgent, not a LaunchDaemon: it has to run inside the logged-in session
(see [The keychain requirement](#the-keychain-requirement)), and the menu-bar
item needs a menu bar.

```sh
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cat > ~/Library/LaunchAgents/com.behiques.hivetty-pro.server.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.behiques.hivetty-pro.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>sleep 20; exec "/Applications/HiveTTY Pro.app/Contents/MacOS/HiveTTY Pro"</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/hivetty-server.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/hivetty-server.log</string>
</dict>
</plist>
EOF
plutil -lint ~/Library/LaunchAgents/com.behiques.hivetty-pro.server.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.behiques.hivetty-pro.server.plist
```

The heredoc is unquoted on purpose: `$HOME` is expanded when the file is
written, because launchd expands nothing in a plist.

What each part is for:

- **No `--server`.** The config's `enabled: true` decides.
- **`KeepAlive`** relaunches the app after a crash, a `kill`, and an update.
  It also relaunches it after *Quit* in the menu-bar item. To stop the server
  for real, unload the agent (below).
- **`sleep 20`** is for updates. An install quits the app so Squirrel can swap
  the bundle, and launchd restarts a long-running job at once; the delay lets
  the swap finish before the new binary starts. At login it also gives
  Tailscale a head start, though nothing depends on that: a bind that fails
  because the address is not up yet is retried, after 5 s and then
  doubling to once a minute, until it lands.
- **Do not also add HiveTTY to Login Items.** Two copies at login means one
  loses the single-instance lock and quits, and launchd relaunches it every
  twenty seconds forever.

Day to day:

```sh
launchctl print gui/$(id -u)/com.behiques.hivetty-pro.server | head -20   # state and pid
lsof -nP -iTCP:7434 -sTCP:LISTEN                                         # the socket
tail -f ~/Library/Logs/hivetty-server.log                               # the log
launchctl bootout gui/$(id -u)/com.behiques.hivetty-pro.server             # stop
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.behiques.hivetty-pro.server.plist  # start
```

A running server has a menu-bar item whose tooltip reads *HiveTTY · serving*.
Its menu shows the bound address (or *Not serving* with the reason), the paired
devices, *Pair a device…* and *Open HiveTTY*. The dock
icon is hidden, and no unread badge appears there: each attached client badges
its own dock.

## 4. Pair each client

On the server, over SSH, once per device:

```sh
hivetty --pair "MacBook"
```

It prints the token once, then the device id and how to revoke it. The token is
never stored on the server, only its digest, so copy it now. The command works
while the server is running; the running server sees the new device without a
restart. The menu-bar item's *Pair a device…* does the same thing.

```sh
hivetty --devices            # who is paired
hivetty --revoke "MacBook"   # cut one device off, at once
```

On the client: Settings, Machines, Server mode, *Attach to a server*. Fill in *Server
address* (the exact `bind.host`), *Port*, *Device id* and *Pairing token*, then
*Attach*. The token goes into the client's own keychain, never into its config
file, and it only ever crosses the network inside the encrypted channel.
Refusals you may meet:

- **An address that is not loopback, on the local network, or a Tailscale
  address** is refused before it dials, and so is a `.local` or `.ts.net` name
  that resolves to a public address. A server elsewhere is reached through the
  relay (HIVE-429, *Connect through relay*), never directly.
- **A wrong token or an unknown device id** ends the encrypted handshake before
  anything else is said; the two look identical on purpose. Pair again.
- **A server on an older HiveTTY** is named as one. Update the server; pairing
  again would not help.
- **Attaching while local sessions are running** is refused and lists them, so
  nothing is left running unseen on the laptop.

Once attached, the whole fleet on the server shows up in the client, Settings
edits the server's config under copy that says so, and a dropped connection
reconnects by itself. A terminal survives the disconnect: the client names the
last output it saw and the server replays the rest, or marks a gap when its
buffer no longer reaches back that far.

## Sign the server in

A server has no one at its screen to finish a browser sign-in, so it signs in with a
code you approve on any other device. Over SSH:

```sh
hivetty --login
```

```text
To sign in this machine, open:
  https://api.hivetty.dev/device
and enter the code:  WDJB-MJHT
Or open: https://api.hivetty.dev/device?code=WDJB-MJHT
Waiting… (expires in 10 minutes, Ctrl-C to cancel)
Signed in as ana@example.com on studio-mac · plan team
```

Open the link on your laptop or phone, sign in there, and approve the code. The
command waits for the approval, stores the account in the server's keychain, and
fetches the plan. When the plan cannot be fetched, it still signs in and says
`plan pending (the app will fetch it)`; a refused plan reads `no plan (<reason>)`.

The command runs while the server is running, and the running server notices the
new account at once through a watch on its data folder, or within 30 seconds at the
latest. There is no restart.

| Exit | Meaning |
| --- | --- |
| 0 | Signed in, or already signed in (nothing changed) |
| 1 | The code was denied, or expired before it was approved |
| 2 | HiveTTY could not be reached, or refused the request |
| 3 | The keychain cannot store a sign-in; nothing was written. See [The keychain requirement](#the-keychain-requirement) |
| 130 | Cancelled with Ctrl-C |

An already signed-in server says who it is signed in as and stops. To sign in again,
as the same account or another, add `--force`:

```sh
hivetty --login --force
```

`--force` reuses the server's Device, so the cloud keeps one Device for this Mac.

To hand the server to someone else, sign it out first:

```sh
hivetty --logout
```

It revokes the server's sign-in (best effort, so it works offline too) and clears it
from the keychain. The running server notices and locks its Pro features, as it would
after signing out from Settings. It also exits 3 when the keychain cannot be opened.

### Serving behind the licence

A server serves only once it holds a licence (HIVE-265).

- **Never signed in, or signed in with no lease:** the listener does not bind. The
  menu-bar item says **Not signed in** (or **No licence** when signed in) and **Not
  serving**, and offers **Sign in…**, which opens the console window on the sign-in
  gate, or **Choose a plan…**, which opens the plan page. The listener binds as soon as
  the licence becomes anything else; there is no restart.
- **Licensed, or in grace:** today's menu.
- **Lapsed:** the listener stays up, so attached clients see the lapse instead of a
  dropped connection. The menu says **Licence lapsed**, how many sessions and agents
  the lapse paused (when any are), and the serving line, and offers **Choose a plan…**, **Sign in
  again…** and **Retry** (renew now).

An attached client whose server has lapsed draws "*server*'s licence has lapsed" and
"Its sessions are paused." over its workspace, with **Disconnect**, which returns it
to this Mac's own fleet. The client's own sign-in gate comes first.

The one licence fact that crosses the socket is `server:licence`: whether the server
has lapsed, and how many sessions and agents it paused, as counts. Names stay on the
server. The server pushes it to attached clients as `server:licence-changed` on every
change, and a client reads it again on every reattach.

## 5. Check it survives a reboot

```sh
sudo reboot
```

Leave the client attached. It says it is reconnecting while the server is down,
and reattaches on its own once the server Mac has logged in, Tailscale is up and the
LaunchAgent has started the app. Nobody touches either machine. If it does not
come back, see [Troubleshooting](#troubleshooting).

## Updates

**The server updates itself.** It checks for a new release 30 s after launch
and every six hours after that. When a signed build finds one, it downloads it
in the background and installs it at the first moment **no session is live and
no agent run is in flight**, looking again every five minutes until then. An
install never cuts off a live session. Installing quits the app; launchd starts
the new version (Squirrel's own relaunch is off on a server, or there would be
two copies, one launchd cannot see).

Two consequences:

- **Update the clients too.** A client on a different protocol version is
  refused at attach with a message saying which side to update.
- **A fleet that is never idle never updates.** A session left open for days
  holds the update for days. Close it, or update by hand.
- **Any quit installs a downloaded update.** Once one is staged, a crash,
  *Quit* in the menu, or `launchctl bootout` also swaps it in, and the next
  start is the new version.

An ad-hoc signed build cannot install in place. It announces the release with a
row pointing at the release page instead, and changes nothing.

### By hand, over SSH

```sh
launchctl bootout gui/$(id -u)/com.behiques.hivetty-pro.server
hivetty --update
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.behiques.hivetty-pro.server.plist
```

`--update` refuses while the server is running, so installation cannot drop
attached clients or PTYs; that is why the agent is stopped first. It prints its
outcome and exits with one of:

| Exit code | Meaning |
| --- | --- |
| `0` | A signed update downloaded and installation has started. On a server, the app does not relaunch itself; the `bootstrap` line does. |
| `1` | The update failed. The printed line says why. |
| `2` | The installed version is current. |
| `3` | This build has no update channel (a development run, or no feed). The printed URL is where releases live. |
| `4` | A newer version exists, but this build must be updated by hand. Download it from the printed release URL on a machine with a browser. |
| `5` | Refused: this machine is still serving. Stop the agent first. |

## What an attached device can do

**Everything.** Pairing grants execute: `pty:spawn`, `pty:write`,
`fs:write-file`, `agents:run` and the rest of the surface. This is a remote
execution endpoint, not an app with a login, and every control below follows
from that.

A few calls are refused to every remote caller, each with its own reason in
the error frame, never a silent change on the server:

- **The native dialogs** (`WINDOW_BOUND`): `config:choose-directory`,
  `skills:file:import`, `skills:import`, `config:reveal`. They would open on a screen nobody is
  watching. The shipped client browses the server's folders with
  `config:browse-directory` and takes skill files by drag and drop instead.
- **`skills:file:drop`** (`REMOTE_REFUSED`): its safety argument, that preload
  minted every source path from a real drop on this device, cannot cross a
  socket.
- **The ten process-local channels** (`PROCESS_LOCAL`): `app:info`,
  `updates:status`, `updates:check`, `config:set-remote`, `config:get-remote`,
  `remote:pair`, `remote:forget`, `remote:dial-now`, `notifications:delivery`
  and `notifications:badge`. Each is about the machine that answers it. A
  shipped client answers them itself, so a hand-built frame asking the server to
  forget its credential, change its attachment, restart a reconnect loop it does
  not have or run its updater is refused. `remote:dial-now` is the client's
  **Try now**: it restarts that client's own reconnect loop, which is why it has
  to answer with the socket down.
- **`notifications:act` carrying `url`, `update.download` or `update.install`.**
  The fleet actions (`ask`, `session`, `agent`, `none`) still cross.

**Where an answer was given (HIVE-218).** `ledger:answer` stamps
`meta.answeredOn` in main. An answer that arrives over a socket gets the paired
device's name (`--pair "<name>"`). An answer from the serving machine's own
window gets its `hostname()`, the name clients already show for the server. A
machine that is not serving stamps nothing. Any `answeredOn` the caller sent is
dropped first. The Inbox uses it to say "answered on mac-mini" when a card
leaves.

## Reaching it from anywhere

**Direct attach stays on a private network.** The client dials loopback, an
address on the local network, or a Tailscale address, and nothing else. It
checks the host before it dials and the address DNS returned before it
connects (`isRemoteTarget` and `isLanHost`, `shared/config-contract.ts`),
so an ngrok hostname, a public DNS name or a forwarded public IP is refused
before a byte leaves the laptop, and so is a `.local` name a hostile resolver
answers with a public address. The relay is the only route off a private
network. [Exposure](#exposure) says why that stays so.

**On one local network** nothing else is needed: bind the server's LAN address
and dial it.

**From anywhere else, Tailscale is the tunnel**: no port forward on the
router, no public server, no ngrok. Tailscale connects the two machines peer
to peer and punches through NAT on both ends. When no direct path exists (a
strict hotel or carrier network), it relays the traffic through its DERP
servers. Either way the client dials the same `100.x` address, from home, from
a hotspot, or from four time zones away.

A relayed link works but adds latency. `tailscale ping <server>` on the client
says whether the path is direct or `via DERP`.

**The encryption is the app's own, on every route.** Each attach runs a Noise
handshake (`Noise_NNpsk0_25519_AESGCM_SHA256`, `remote-channel/`)
keyed by a fresh X25519 exchange and the device's pairing secret, and every
frame after it is AES-256-GCM. A WireGuard tunnel underneath is a second layer,
not the one this link relies on.

### Headscale instead of Tailscale's coordination server

[Headscale](https://github.com/juanfont/headscale) is a self-hosted
replacement for Tailscale's control plane. Run it on a small VPS with a public
HTTPS address, then point the Tailscale client on the server and on every
laptop at it (`tailscale up --login-server https://<your-headscale>`). The
WireGuard mesh and the app work as above, with two limits:

- **Dial the `100.x` literal, never a MagicDNS name.** The client admits names
  ending in `.ts.net` or `.local` only. Headscale's MagicDNS uses the `base_domain` you
  configure, so a name like `mini.hive.example` is refused. Set `bind.host` on
  the server and *Server address* on the client to the same `100.x` address.
- **Keep the IPv4 prefix inside `100.64.0.0/10`.** That is Headscale's default.
  A custom prefix outside it, or an IPv6 tailnet address, is refused by the
  same guard.

Headscale's default config still uses Tailscale's public DERP relays. To keep
relayed traffic off Tailscale's servers as well, enable Headscale's embedded
DERP server and drop the default map.

## Through the HiveTTY relay

**What it is for.** A server you own, reached from another network with no
Tailscale, no port forward and no inbound connection on either machine. Both
Macs dial out to HiveTTY's relay, and the relay joins the two connections.

**Turning it on.**

- On the server: **Settings › Machines › Server mode**, open **Serve this
  machine**, then turn on **Reachable through HiveTTY relay**
  (`server.relay.enabled`). It needs the app running in server mode, signed in
  to HiveTTY, on a plan that includes the relay. Turned on in a window that is
  not serving, it reads *Starts at next launch, with serving.*
- On the client: open **Attach to a server**, turn on **Connect through
  relay** (`remote.via: "relay"`), pick the server in **Server**
  (`remote.relayServerId`), then **Attach**. **Refresh** reads the list again.
  The list holds your Macs that hold the relay right now, named as in
  **Account › Devices**. A server you saved that is not online reads *Saved
  server · offline*.
- Pairing is unchanged. The client still needs that Mac's device id and token
  from `hivetty --pair`.

**A headless server** signs in with `hivetty --login` (see [Sign the server
in](#sign-the-server-in)).

**Where the relay is.** It is the same address the app signs in to, over
`wss`. For a self-hosted cloud, `account.cloudUrl` moves both. There is no
separate relay address to configure.

**What the relay can see:** which account, which device, when, and how many
bytes. **What it cannot see:** anything inside the encrypted channel, which is
terminal output, keystrokes, file contents and the pairing token. The Noise
handshake runs end to end between the two Macs, through the relay, exactly as
it does on a direct attach.

**The same-person rule.** A client lists and reaches only Macs signed in to
its own HiveTTY account, and still needs that Mac's pairing token. Another
account's server is neither listed nor reachable.

**When it drops**, the client reconnects on the usual schedule (1, 2, 4, 8, 15
and 30 seconds, then every 30) and terminals resume where they left off. While
the server is not serving, the reconnecting banner says *The server is
offline.*

## Exposure

The controls, in order of how much they carry:

1. **The encrypted channel.** Every attach runs inside it. A peer without a
   device's pairing secret cannot complete the handshake, and the server sends
   it nothing at all: a wrong token and an unknown device id end the same way,
   with a close and no frame. Nobody on the path reads or changes a frame.
2. **Device tokens.** One per device, compared in constant time, revocable one
   at a time with `--revoke`. A revoked device still completes the handshake and
   is then refused, inside the channel, as revoked. A laptop that joins your
   network, or is stolen, is not trusted by being there.
3. **The address refusals.** The server binds loopback, the local network or
   the tailnet, never a public address or every interface. The client dials the
   same set. No port forward, no public DNS, no ngrok: those put a remote
   execution endpoint on the internet.
4. **A Tailscale ACL, if you use Tailscale.** Limit which of your devices can
   reach port 7434 at all. `ssh -L` over the tailnet is a good break-glass path.

What the channel does not do:

- **The digest in the server's config is key material.** It is the channel's
  pre-shared key for that device. Whoever holds the server's `config.json` and
  sits on the path between the server and that device can pretend to be the
  server to it. Guard the file as you would the token.
- **Old builds are refused, not downgraded to.** A client or server from before
  the channel is told to update; nothing falls back to an unencrypted socket.

What an unauthenticated peer on your network can cost the server: the
channel's hello and the attach frame after it are held to 8 KiB
(`ATTACH_FRAME_MAX_BYTES`), but a socket's receiver is built with the
post-attach ceiling of 8 MiB (`POST_ATTACH_FRAME_MAX_BYTES`), at most eight
sockets may be mid-handshake at once (more get a 503), and each has 5 s to
complete the handshake and attach before it is closed. So strangers can make
the server buffer about 64 MiB for a few seconds, and nothing past that.
Attached sockets are not capped in number; only paired devices get there. That
bound is why the bind address matters: on a private network it is a small
exposure, on every interface it would not be.

The hook receiver stays on loopback. Everything that calls it (the sessions,
the agents, any containers) runs on the server.

Over a slow link: terminal output is framed as JSON, about 5 % over the raw
bytes at normal flush sizes.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The menu reads *Not serving* | Either `bind.host` is not an address of this machine yet (Tailscale still starting, or the LAN address changed), which retries by itself, or the config refused it (a wildcard, a public address, or not a valid host), which the reason names and which waits for you to fix the block. If it never lands, check `ipconfig getifaddr en0` or `Tailscale ip -4` against the config. |
| Client gets a 403 | It dialed a name the server did not bind. Use the exact `bind.host` string. The server's log names the refused host. |
| Client says the versions differ | Update whichever side the message names. |
| Client says the server is on an older HiveTTY | The server predates the encrypted channel. Update the server. |
| Client says to pair again | The server did not accept this device's pairing: the token is wrong, or the device was never paired there. Run `hivetty --pair` on the server and enter the new token. |
| Jira or Slack shows signed out after a reboot | The login keychain is locked: automatic login is off, or the keychain password differs from the account password. |
| Log says another server is already running for this config | Two copies started. Remove HiveTTY from Login Items; keep only the LaunchAgent. |
| Server never updates | Something is always live. Check for a long-lived session or a busy agent schedule, or update by hand. |
| `hivetty --login` exits 3 | The keychain is locked: nobody is logged in to the Mac's desktop. Log in once, in person or over Screen Sharing, so the login keychain unlocks, then run it again. See [The keychain requirement](#the-keychain-requirement). |
| Menu-bar item shows the text "Hive" | The bundle is missing `Contents/Resources/tray/`. Reinstall. |
| *Sign in again to use the relay* | The relay refused the account (4401): this Mac is signed out, or the device was removed in **Account › Devices**. Sign in again. |
| *Your plan does not include the relay*, or a locked relay switch | The relay refused the plan (4403). **Upgrade**, or attach directly. |
| *The server is offline* | The relay has no server for that id (4404): the server is not running, not in server mode, signed out, or its **Reachable through HiveTTY relay** switch is off. The client keeps retrying. |
| *Another HiveTTY on this Mac took over the relay* | Two installs signed in as one device both tried to serve (4409). Turn **Reachable through HiveTTY relay** off and on in the one that should serve. |
| *The relay is limiting new connections* | Too many attaches in a short time (4429). The client retries on its schedule. |
| A relay attach reconnects every few minutes with no message | The relay restarted, or the other side dropped (1012 or 1001). Nothing to do; terminals resume. |
