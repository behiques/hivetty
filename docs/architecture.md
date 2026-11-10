# Architecture

The map for the team working on HiveTTY Pro. Each box below has a deep dive; this page says which.

**On this page:** [At a glance](#at-a-glance) · [Processes](#processes) ·
[Where things live in the tree](#where-things-live-in-the-tree) · [The rules](#the-rules) ·
[Where to read next](#where-to-read-next)

## At a glance

HiveTTY Pro is one Electron app with a strict process model. The renderer (`src/`) is React,
four Zustand stores and xterm; it reaches the main process only through verbs the preload
exposes on `window.hive`. Main (`electron/main`) is the single policy point: it validates
every call, owns the config, the ledger, session history and the hook receiver. Terminals run
in a separate PTY host process, so a crash there cannot take down main. Every session runs one
of three agent CLIs (Claude Code, Codex or Copilot), and main speaks to each through one
**harness port** (`electron/main/harness/`): an adapter per CLI builds its command line, wires
its hooks, reads its meters and runs it headless for agents, so nothing outside the harness
asks which CLI it has. Each CLI starts its own MCP host over stdio to reach the ledger (over
HTTP from a container). The **licence** (`electron/main/licence/`) signs in against the
HiveTTY cloud and holds a signed, time-limited lease whose entitlements turn paid features on,
Codex and Copilot among them; the renderer's gate covers the window until a lease is valid.
`electron/shared` is the only code both sides import.

## Processes

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/diagrams/processes.dark.svg">
  <img src="assets/diagrams/processes.light.svg" alt="Renderer, preload, main with the harness, hook receiver, ledger and licence, the PTY host, the Claude Code, Codex or Copilot CLI and its MCP host">
</picture>

| Process | Deep dive |
| --- | --- |
| Renderer shell, rails, views | [Component patterns](component-patterns.md) |
| Stores and selectors | [State and data](state-and-data.md) |
| The terminal component and transports | [Terminal architecture](terminal-architecture.md) |
| Main, IPC, the PTY host, status | [Desktop architecture](desktop-architecture.md) |
| Explorer and editor, the fs surface | [Explorer and editor](explorer-and-editor.md) |
| Ledger, MCP host, agents | [Agents and the ledger](agents-and-ledger.md) |
| The harness port, the Claude Code, Codex and Copilot adapters | [Harness architecture](harness-architecture.md) |
| Sign-in, the lease, entitlements, billing | `electron/main/licence/`, `src/features/account/`; the user's view is [Settings › Account centre](guide/settings.md#account-centre) |
| Remote listener and pairing | [Server mode](server-mode.md) |
| Build, sign, publish, update | [Packaging and updates](packaging-and-updates.md) |

## Where things live in the tree

```text
src/
  components/layout/     the composition root: rails and centre stage mount features
  components/terminal/   the terminal seam (speaks only TerminalTransport)
  components/editor/     the editor seam
  features/<slice>/      account, agents, editor, explorer, home, inbox,
                         orchestrator, plan, projects, pull-requests, sessions,
                         settings, whats-new, work, shared
  lib/swarm/             pure canvas modules (HIVE-199): the palette type, the
                         comb's layout, motion and drawing, and the Brood
                         (HIVE-221): tone (the palette as numeric RGB, the one
                         colour formatter), kit (the shared math and drawing
                         helpers), muta (the top-down mutalisk, its spine
                         simulated live per flyer), brood (the creature
                         contract and paintCreature, which fits one into a
                         canvas) and the four SwarmCreature drawings: spire,
                         hover (the hovering mutalisk), overlord and hive.
                         Each is a pure draw(ctx, t, s, tone) on its own loop,
                         its seeded anatomy grown on first draw. No colour
                         literals outside
                         tone and no imports outside the folder. The splash's
                         one exception to its fence (HIVE-212): it may import
                         muta, tone, kit, palette, the comb (MUTA_SCALE) and
                         lib/theme/colour, and nothing else from lib/
  stores/                hive, ui, appearance, editor
electron/
  main/                  config, sessions, hooks, ledger, agents, integrations, server
  main/harness/          the port, and an adapter each: claude-code/, codex/, copilot/
  main/licence/          sign-in, the lease and its entitlements, devices, billing
  preload/               the bridge
  pty-host/              terminals
  mcp-host/              the hive MCP server
  shared/                contracts both sides import
tests/                   mirrors src/ and electron/
```

## The rules

Enforced by ESLint, proven by `pnpm verify:boundaries`. The full table is in
[`AGENTS.md`](../AGENTS.md).

- Feature slices never import each other (except `features/shared`).
- `src/components/terminal/` and `editor/` import no features, data or stores. The terminal
  seam is the most important invariant in the code.
- Components read stores only through named selector hooks. Derived values are never stored.
- Only `appearance-store` persists, to `localStorage`.
- No raw hex in components: colour comes from `--cc-*` tokens (the terminal from the theme's
  JS palette).
- Only `electron/main/harness/` may import an adapter, and an adapter never imports sessions, IPC, notifications or plans.

## Where to read next

- Changing the UI: [Component patterns](component-patterns.md), then the
  [design system](../.claude/DESIGN-SYSTEM.md).
- Touching IPC or sessions: [Desktop architecture](desktop-architecture.md).
- Adding or changing a CLI: [Harness architecture](harness-architecture.md).
- Before any change: [Development](contributing.md).
