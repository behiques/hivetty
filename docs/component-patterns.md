# Component patterns

**Scope:** panels, atoms, the rails, and the center-stage view-state machine.

> **TL;DR**
> - `src/components/layout/` is the composition root; feature slices never import each other.
> - The page never scrolls; rails never flex; `min-h-0` and `min-w-0` are load-bearing.
> - A pure `resolveView` picks the one thing on stage: settings, picker, editor, then a tab.
> - Terminals are hidden, never unmounted. The editor unmounts when nothing is open.
> - The activity rail is a map of Inbox, PRs and Explorer.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/diagrams/fd-component.dark.svg">
  <img src="assets/diagrams/fd-component.light.svg" alt="How the centre stage decides what to show">
</picture>

**On this page:** [The shell](#the-shell) · [The header](#the-header) ·
[The view-state machine](#the-center-stage-view-state-machine) ·
[The orchestrator console](#the-orchestrator-console) ·
[The session / agent view](#the-session--agent-view) ·
[The picker](#the-new-session-picker) ·
[The activity rail](#the-activity-rail) ·
[The editor](#the-editor-on-the-centre-stage)

## What already holds today

- Chrome lives in `src/components/layout/`, shared atoms in
  `src/components/ui/`, and domain surfaces in `src/features/<slice>/`.
- A feature slice follows the bulletproof-react shape: `components/`, `hooks/`,
  `stores/`, `types/`, `utils/`, plus an `index.ts` barrel that is the only thing
  outside code imports.
- Slices never import each other. Cross-slice communication goes through the
  store, or through `features/shared`.
- `src/components/**` may not import from `features/**` — chrome and atoms stay
  domain-agnostic.
- Colour comes from `--cc-*` tokens via Tailwind utilities. Raw hex literals in
  component code are banned.
- Only the shadcn primitives actually needed are installed: `dialog`, `tooltip`,
  `dropdown-menu`.

## The shell

`src/components/layout/app-shell.tsx` is the whole chrome. `src/app.tsx` renders
it and nothing else.

```
<body>                      100vh, overflow hidden, --cc-bg / --cc-ink
└── AppShell                flex column, h-full
    ├── Header              <header>  56px fixed, --cc-panel, border-bottom soft
    └── Row                 flex-1, min-h-0, flex
        ├── LeftRail        <nav>     320px fixed, --cc-panel, border-right soft,
        │                             own vertical scroll
        ├── CenterStage     <main>    flex-1, min-w-0, --cc-panel-2, flex column
        └── ActivityRail    <aside>   316px fixed, --cc-panel, border-left soft,
                                      own vertical scroll, unmounted when hidden
```

Each region is a landmark element, so tests address them by role
(`banner` / `navigation` / `main` / `complementary`) rather than by class.

## The round-two shell (HIVE-195)

Settings › Appearance › **Layout** picks the frame. Classic, the default, is the
tree above: `LeftRail` plus HIVE-105's `RailHandles`. Round two swaps the left of
the row for `ActivityBar` (a 64px `<nav aria-label="Places">`) and `ListPanel`
(one 300px list for the current place), and drops the handles — the panel is
fixed. `Header` and `TitleBar` render in both.

```
Row (Classic)       LeftRail                 │ CenterStage │ ActivityRail │ RailHandles
Row (round two)     <>ActivityBar ListPanel</> │ CenterStage │ SessionPanel
```

**`CenterStage` holds child index 1 in both layouts**, because the fragment and
`LeftRail` share slot 0. React therefore keeps the same instance across the
switch and no live terminal is torn down; wrapping the stage into each branch
would remount all of them on a settings click. Round two's right edge is the
session panel, below, in place of the `ActivityRail`.

### The place machine

Two `ui-store` fields drive the bar: `place` (`'home' | 'sessions' | 'work' |
'agents' | 'prs'`, Home on every launch) and `panelOpen`. `selectPlace(p)` is
the bar's whole interaction:

- **A new place** opens its panel and dismisses the picker and settings, as
  `openTab` does.
- **The active place** toggles its panel — except **Sessions with a session on
  stage**, which goes back to the Overmind first and leaves the panel alone.

Openers move the bar with what they open: `hive-store` calls
`openTab(id, place)` from `spawnSession`, `spawnTerminal`, `resumeSession` and
`openEntity` (an agent lands on Agents, anything else on Sessions), and
`backToOrch` lands on Sessions because the Overmind is that place's page.
Cleanup does not: when the tab on stage is removed or its session ends,
`removeTerminal` and `finishSession` call `openTab('orch')`, so a session
ending behind Home does not yank the user to Sessions. `clearSession` passes no
place either — it replaces the tab already on stage rather than opening one.

### The rules the layout depends on

- **`min-h-0` on the row and `min-w-0` on the center stage.** A flex item
  defaults to `min-*: auto` and refuses to shrink below its content. Without
  `min-h-0` a tall rail pushes the shell past the viewport instead of scrolling
  inside itself; without `min-w-0` a long terminal line widens the center column,
  which xterm's fit addon then measures and grows into. Both are load-bearing,
  not defensive.
- **The rails never flex** (`w-[var(--cc-rail-w-left)]` /
  `w-[var(--cc-rail-w-right)]` + `shrink-0` — 320px and 316px by default, set
  by drag or density through the token), so the center column absorbs every
  width change and the document never gains a horizontal scrollbar.
- **The overmind splits its column.** On the orchestrator view the fleet table
  sits in a pane with `flex: 0 1 <ratio>%` of the box it shares with the
  transcript, behind a horizontal `SplitHandle` (`FleetPane`, in
  `features/orchestrator`). Half by default, capped at the table's content,
  persisted as `consoleSplitRatio`.
- **The page never scrolls.** `body { overflow: hidden }` plus `overflow-y-auto`
  on each rail — three independent scrollbars, and the terminal keeps a stable
  size regardless of what lands in the rails.
- **The activity rail unmounts rather than hides.** `showActivityRail` in the
  ui-store is read through `useShowActivityRail()` — deliberately narrower than
  `useRailState()`, so switching rail tabs does not re-render the terminal.

Desktop-width only, by design: no responsive or mobile layout. The rails are
draggable (`rail-handles.tsx`), and either one collapses to an icon strip.

## The session panel (HIVE-201)

Round two's right side is `SessionPanel` (`src/components/layout/session-panel.tsx:90`),
mounted by `app-shell.tsx:205` in place of the `ActivityRail`: 320px open, or a
46px strip closed. Classic is unchanged, and only Classic still draws
`PlanRail` beside the terminal (`center-stage.tsx`).

**The gate (R1).** It draws while the stage shows a session or a terminal, and
is not gated on the view. A file opened full-stage from the Files tab must not
make the panel vanish under the click. The Overmind, agents and Home have no
such entity, so it returns `null` there.

**The tab table.** `TABS` (`session-panel.tsx:48`) is one row per tab: `id`,
`label`, `exists`, `Icon`, `fact`, optional `count`, `body`. The tablist, the
strip and the body all read it, so a new tab is one row. Plan exists once the
plan has a task; Files always does. HIVE-202's Ticket and HIVE-209's PR go
between them, and `SessionPanelTab` already names them.

**`pickTab`** (`session-panel.tsx:77`) chooses what shows: the persisted tab
where it exists, else Plan, else Files. A persisted `'ticket'` is harmless
until Ticket has a row.

**The strip** (`session-panel-strip.tsx`) is the closed panel: the plan's rings
on top (`PlanRings`, shared with `PlanRail`), then one icon per other tab with
its one fact, such as `2 files changed`. Any of them opens the panel on that
tab. Below 1,200px `use-narrow-window.ts` forces the strip whatever the open
setting says; with no `matchMedia` it reads as wide. In round two the right
chord toggles the panel (`use-app-chords.ts:78`).

**The main-id rule (R2).** Plans and changed files are keyed by main's id, and
a session's is `terminalOf(session)`, not `session.id`. The panel derives it
once (`session-panel.tsx:94`) and passes it down as `mainId`, and a terminal
has none, so it gets Files without a plan or marks.

## The header

`src/components/layout/header.tsx` fills the shell's top region.
Anatomy, sub-component contracts, and the two easy-to-get-wrong details live in
[`../.claude/COMPONENTS.md`](../.claude/COMPONENTS.md). The pattern worth
repeating in every other region:

**Chrome composes; the leaves subscribe.** The header itself reads only what its
own controls need. `ModelChip` and `StatusCounts` each own their store
subscription, so a session changing status repaints one span rather than the
whole bar. Rails and panels should be built the same way — a container that
subscribes on behalf of its children re-renders all of them.

Its corollary in tests: sub-components are asserted in their own files, and the
container's tests cover only the wiring.

## The center-stage view-state machine

The stage shows **exactly one thing at a time**, and which one is decided by a
pure function rather than by nested JSX conditionals:

```ts
resolveView({ activeTab, picker, settings, home, work, entity, editorFull })
  : 'settings' | 'picker' | 'home' | 'work' | 'editor' | 'orchestrator'
  | 'session' | 'agent' | 'terminal'
```

Precedence runs settings → picker → home → work → editor → orchestrator → entity.

It lives in `src/lib/resolve-view.ts` and is tested exhaustively. A machine
embedded in JSX is one that grows a seventh state by accident; this one cannot.

Two precedence rules carry the weight:

- **Picker wins over everything**, and deliberately does *not* change
  `activeTab`. That is what lets closing it return the user to whatever was
  underneath — the tab was never touched.
- **The orchestrator is the floor.** An `activeTab` naming no entity resolves
  there rather than to a blank stage, because a session can be removed while its
  tab is open.
- **Home sits below both overlays and above everything else** (HIVE-195).
  `home` is true when the layout is round two **and** the place is Home. Like
  the overlays it never touches `activeTab`, and it is neither an entity view
  nor a terminal view, so the foreground gate (HIVE-81) reports no session
  while Home covers the stage. `CenterStage` hides the terminal region behind it
  exactly as it does behind the picker.
- **Work sits where Home does** (HIVE-203). `work` is true when the layout is
  round two and the place is Work; the place always owns the stage, the open
  ticket's page or "Pick a ticket". One place is open at a time, so `home` and
  `work` are never both true.

### Home: The Comb (HIVE-199)

Home is `features/home`'s `HomePage`: a visually hidden `<h1>Home</h1>`, then
`CombHeadline` ("N things need you" over the counts) laid over `TheComb`, a hex
canvas of every live session, terminal and agent. HIVE-200's strip mounts
under the comb.

**The canvas host pattern.** `TheComb` is the example to copy for any animated
canvas:

- It lays out and draws in a **logical space** (1376 × 520, the prototype's
  canvas) and scales it uniformly to the element; hit-testing converts the
  pointer back into logical units.
- A `ResizeObserver` keeps the backing store at the element's size, device
  pixel ratio capped at 2.
- `requestAnimationFrame` runs only while the canvas **intersects** the
  viewport, the document is **visible** and the component is **mounted**;
  elapsed time is real and clamped, so a 120 Hz display flies no faster.
- Data and the palette reach the loop **through a ref**, so a session changing
  state or a theme switch repaints the next frame without restarting it.
- Under reduced motion there is no loop: one still frame, redrawn when the data
  or the palette changes.
- Colour comes from `useSwarmPalette()`, never `getComputedStyle`;
  `src/lib/swarm/` holds no colour literal.
- A visually hidden list holds one button per cell, labelled with the tooltip's
  text, so the comb works from the keyboard and reads to a screen reader.

### What the component does with it

`CenterStage` is the composition root: it reads the stores so
`components/terminal/` never has to, builds one cached `StaticTransport` per
entity, and renders `SessionMetaBar` only for the two entity views.

Round two composes two of the views differently (HIVE-197):

- **orchestrator** is `OvermindHead`, the fleet table (`FleetPane`), the
  transcript, and the dock (`ConsolePeek` over `ConsoleInput`). The transcript
  is folded by default: its row is hidden and `activeId` is `null`, exactly as
  behind the picker, and `FleetPane` drops its divider and fills the page.
- **session** and **terminal** are headed by `SessionHeader`, which also covers
  terminals. Classic keeps `SessionMetaBar`, sessions only.

**The picker hides the terminal region; it never unmounts it.** Unmounting would
dispose every live xterm instance and throw away its scrollback. The region is hidden with a class, and `activeId` is passed as
`null` so each surface marks itself invisible — which also means closing the
picker re-reveals the previous surface and refits it through machinery that
already exists.

`overflow-hidden` on the stage enforces the rule that the stage never
scrolls as a whole; only the terminal region does.

### A consequence worth knowing

The meta bar appearing above a terminal *shrinks* that terminal. Rows come off
the bottom of the viewport, so a terminal parked at the end of its transcript
would silently show the middle of it. `TerminalSurface` therefore applies the
bottom-stick rule to fits as well as to writes — see
[`terminal-architecture.md`](terminal-architecture.md).

## The orchestrator console

Three surfaces stacked inside the orchestrator view, in this order:

1. **`SessionTable`** — the fleet, as **DOM, not xterm**. Rows have to stay
   clickable and focusable, which terminal text cannot be. Eight active
   sessions, an `ENDED` divider, then the ones that have finished or
   terminated. A `terminated` row is `disabled`: it still reads and still
   selects, but its pty is gone and entering it would show a dead rectangle.
2. **The transcript** — an ordinary `TerminalSurface` bound to the `'orch'`
   pseudo-entity, so the console gets real ANSI colour and selection for free.
3. **`ConsoleInput`** — the command row and the hint bar beneath it.

The concept scrolls the table and transcript as one region. They cannot be: the
transcript is a real xterm with its own viewport, and a DOM table cannot share
it. The table keeps its own scroll and the terminal fills what is left.

### Parse, then execute — two halves that fail differently

```
parseCommand(raw) → ParsedCommand → runOrchCommand(parsed)
```

- `features/orchestrator/utils/parse-command.ts` is **pure**. It catches *shape*
  errors — `send` with no message, an unknown verb — and never touches the store.
- `hive-store.runOrchCommand` takes an already-parsed command and catches
  *existence* errors — no such session, unknown repo.

The type lives in `types/command.ts` rather than beside the parser because
`stores/` may not import `features/`. That constraint produced a better shape
than it interrupted: the union is the closest thing the prototype has to the
future daemon's API surface, and both halves are exhaustively testable alone.

`status` colours each row by session status rather than colouring the status
column alone — `TermLine` carries one colour per line, and a wall of amber still
reads as "these need you".

The transcript is capped at 200 lines. Unlike the feed's cap, this one has a
second job: the transcript is replayed into an xterm on every subscribe, so an
unbounded array would make opening the orchestrator slower over time.

### Selectors and the re-render trap

The table's two groups come from `useActiveSessions()` and `useEndedSessions()` —
two flat selectors, deliberately **not** one returning `{ active, ended }`.

`useShallow` compares the returned value's own properties. An object holding two
freshly-built arrays is never shallow-equal to the previous one, so the component
re-renders, rebuilds the arrays, and loops until React throws "Maximum update
depth exceeded". Flat arrays are compared element by element, which is what makes
them stable. This cost a debugging cycle; it is written down so it costs nobody
another.

## The session / agent view

Meta bar, terminal, and — over a **recording** — a message row. The row is
`MessageInput`, mounted by `CenterStage` and **keyed by entity id** — switching
sessions remounts it, which both clears a half-typed message meant for somebody
else and re-runs its autofocus.

### A live session has no message row

The row is mounted only where the surface above it cannot be typed into: the
browser demo and the agent tabs, both replays. A live desktop session already
*is* Claude Code's prompt, and a second text box beneath it gives one session two
places to type, with different keybindings and no way to tell from the caret
which will receive the next character. The two autofocuses were also racing on
every newly opened session, which is how a brand-new session came to swallow what
was typed into it.

The keyboard goes to the terminal instead: `TerminalSurface` focuses itself when
it **becomes visible** and is interactive — reveal rather than mount, because
instances are created lazily and kept alive hidden, so the two coincide only
once. Read-only surfaces are excluded, which is what keeps the orchestrator
console's own command row focused.

There is no `session-view.tsx` wrapper. The terminal belongs to the shared
`TerminalHost`, so a component wrapping meta bar + terminal + input would have
to reach into it; composition happens in the stage instead.

The rule: mount feature panels directly from the region's component in
`src/components/layout/`, with no composition module inside a feature slice.

### Send is one action with an origin

`sendToEntity(id, msg, origin)` handles both paths. The transcript records who
spoke, so the echo differs — `❯ [orchestrator] msg` from the console, a blank
line then `❯ msg` from the session's own row — but the acknowledgement is one
shared line, because it means the same thing either way.

One timer per message: two rapid sends produce two independent acknowledgements
rather than one cancelling the other. `appendEntityLines` only applies a status
to sessions, so agents stay `online` with no branch at the call site.

### Click-to-focus, without eating the selection

Clicking the terminal focuses the message row — but only when
`window.getSelection()` is empty. Moving focus collapses the document selection,
so an unconditional focus-on-click would delete the highlight the user's drag had
only just made. Over a live terminal the stage steps aside entirely and the
surface focuses itself, which is the same guard duplicated rather than assumed:
it is the same bug in both places.

## The agent page

`AgentPage` (`features/agents/components/agent-page.tsx`, HIVE-204) is one agent's page:
a header, then the body the switch picks. The header carries the identity, the
`SegmentedControl` for **Activity | Definition**, and Run now; in Classic, which has
no bar, a back button too, until HIVE-213 retires Classic. Pause and Resume live in the
panel row's slot. Activity is `AgentView`;
Definition is `AgentDefinition`, which owns read, save, rename, delete, revert and the
shipped strip for one agent and renders `AgentEditor`.

- **Which agent, which view** is `agentPage` in ui-store (`openAgentPage`,
  `setAgentPageView`, `closeAgentPage`); `name: null` is a new agent never saved.
  `openTab(id, 'agents')` sets it to Activity, so `openEntity` needs no change.
- **The stage.** `resolveView` takes `agents` (the Agents place owns the stage: round
  two, or Classic with a page open) and returns `'agents'` unless the active tab is an
  agent, which still resolves to `'agent'`. `'agents'` mounts `AgentsStage`: the page, or
  "Pick an agent". Both mount `AgentPage` keyed by name.
- **Drafts** live in editor-store's `agentDrafts`, keyed by name (`''` for the new agent),
  so leaving the page loses nothing and asks nothing. Revert is the only discard. A Save
  that creates or renames moves the draft to the new name.
- **Run now** refuses with `runRefusal` (no file, or a dirty draft) and otherwise answers
  through `agentRunQueued` / `agentRunRefusal`. The notice is the page's, drawn by
  whichever view is showing.
- **The run table drives the output.** `AgentRunLog` owns `selected`, the latest run by
  default; a new run takes it only when the latest was selected (a ref holds the previous
  latest so the effect can tell following from pinned). Click, Enter or Space selects and
  `jumpTo`s; the selected row gets `bg-panel-2` and an inset brand bar; the heading names
  it. Outcomes take `failed` red and `asking` amber from the terminal palette, the reason
  rides inline, and Took is `formatDuration` (`@lib/format-duration`).
- **Settings stays fenced.** Settings › Agents opens the page through ui-store and
  imports nothing from the agents slice; the atoms both use (`SettingsGroup`,
  `InlineConfirm`, the shipped marker) live in `features/shared/components/`.

## The agent row

`AgentRow` (HIVE-204) is a tile and two lines with a slot, and the slot is the pattern
worth copying. Line 1 ends in a fixed-width cell that shows the age at rest; the actions
are an absolutely positioned sibling of the row button, `invisible` until
`group-hover` / `group-focus-within`, laid over that cell. Siblings rather than children,
because a button inside a button is invalid and loses its tab stop; fixed width, so the
name never shifts when the actions appear. The age hides under the same variants. A
transient answer (a refusal, a queued wake) replaces line 2 for five seconds as
`role="status"`, on a timer the next notice re-arms and unmount clears.

## The new-session picker

Keyboard-first: New session → type a query → Enter → a live terminal, hands
never leaving the keyboard. Pinned pills for the first four projects, two
bespoke steppers for model and effort, and a search box over all projects.

### Why the Radix primitive rather than `components/ui/dialog`

The vendored `DialogContent` always portals to `document.body` and centres a
fixed-position card. This picker **fills the center stage** — rails and header
stay visible, as the concept shows — so it composes `Dialog.Root` and
`Dialog.Content` from `radix-ui` directly and renders in place.

What the picker needs from Radix is its *behaviour*, and the parts that
matter are kept: the focus trap, Escape, and `aria-modal` — all of which live in
`Content`. `onOpenAutoFocus` is intercepted so focus lands on the search box
rather than the container.

**Scroll locking is not kept**, and that is deliberate: Radix implements it in
`Dialog.Overlay`, which this picker omits because an overlay would paint a scrim
across the whole app and destroy the full-stage look. The shell is a
fixed-height, non-scrolling layout, so there is no page scroll to lock.

### The steppers

`OptionStepper` is bespoke and lives in this slice because nothing else uses it.
Its *semantics* are a radio group, so that is the role it exposes — and the
keyboard contract that role promises is implemented, not merely announced:
arrow keys step the selection (clamped, not wrapped), focus follows selection,
and roving `tabIndex` makes the group a single tab stop. Exposing `role="radio"`
without those is worse than using plain buttons, because it advertises an
interaction that does not exist. The track and fill are `aria-hidden`; the dots
carry the meaning.

Model and effort live in `ui-store`, not component state, so a deliberate choice
survives closing and reopening the picker.

### Spawn logging belongs to the store

`spawnSession` asks main for the process itself and writes main's refusal to
the console, so every caller — the `spawn` command, the picker, a daemon event
later — gets the same line. It does **not** announce a successful spawn:
at that moment the session has nothing but its id, which is the one
label the user never sees anywhere else, and the session lists already show
what launched.

## The activity rail

Structurally the left rail's twin, and deliberately so: a `Record<TabId,
ComponentType>` panel map, a pinned `<TabBar />`, and a `role="tabpanel"`
wrapper labelled with `tabId(active)` that owns the scrollbar. Two rails, one
shape — if you are adding a third tabbed region, copy this and not something
new.

```tsx
const PANELS: Record<RailTab, ComponentType> = {
  inbox: InboxPanel,
  prs: PrsPanel,
  explorer: ExplorerPanel,
};

const Panel = PANELS[railTab];
```

The map beats a `switch` in the body for one reason worth stating: `Record<RailTab,
…>` makes a new member of the union a **type error** here rather than a tab that
silently renders nothing.

### Scroll position resets on switch

The choice is explicit: **reset**. Preserving per-panel
`scrollTop` means either keeping all three mounted or mirroring offsets into the
ui-store. Neither earns its complexity for three short lists, and a stale offset
into a list the simulation just prepended to is worse than starting at the top.

### One badge is loud, the rest are quiet

`TabBar` takes an optional `badgeTone`. Everything defaults to `muted`; the
Inbox tab passes `danger`, because its count is the one number in the app that
means *the user is what an agent is blocked on*. See
[`../.claude/COMPONENTS.md`](../.claude/COMPONENTS.md) for the atom contracts.

### The panels are feature slices, mounted from the composition root

`InboxPanel`, `PrsPanel`, and `ExplorerPanel` live in three separate slices
that cannot import each other. They meet only here, in `components/layout/` —
which is exactly what the composition-root exemption exists for. Rules the two
PR-rendering surfaces must agree on live in `features/shared/`, never in one
slice reaching into another.

The third tab used to be `ActivityFeedPanel`, a feed of fixture rows narrating
events the app already shows elsewhere. It was deleted rather than moved: the
orchestrator's own transcript already answers "what did it just do", and the
feed was a second, invented telling of the same thing. `ExplorerPanel` answers
the question the app could not — *what is the agent actually changing*.

The filesystem watcher is **not** the panel's, though an early revision made it
so. It sits at the composition root in `useProjectWatcher`, alongside
`useSessionStatus` and for the same reason: the tree is only one consumer, the
editor on the centre stage is the other, and the editor outlives the rail tab.
A watcher scoped to the panel meant an open file stopped reconciling the instant
the user clicked Inbox.

## The editor on the centre stage

The stage's view machine gained a sixth state, and the shape of the addition is
the part worth knowing:

```
settings  >  picker  >  editor  >  orchestrator | session | agent
```

`resolveView` returns `'editor'` **only in full-stage placement**. In a split the
editor is not a view state at all — it is a layout of the entity view, rendered
beside the terminal under whatever view already resolved. Modelling split as a
seventh state would make `isEntityView` lie about whether the session meta bar
and the message row should be mounted.

Two consequences follow, and both are load-bearing:

- **The tab strip is stage chrome, not editor chrome.** It renders whenever
  something is open, above both regions, so selecting Terminal does not take the
  strip away with it and strand the open files behind a control that no longer
  exists.
- **A Terminal entry appears exactly when the terminal is hidden** — which is
  only ever full-stage placement. That single rule is what lets placement and
  nav model be independent settings rather than four hand-written layouts.

The terminal region is `hidden`, never unmounted, for the reason the overlays
already establish: every live xterm and its scrollback would go with it. The
editor is the other way round — it is unmounted when nothing is open, because
`editor-store` still holds the text and a hidden editor would keep a document
and a `ResizeObserver` alive to show nothing.

## The plan rail

A session's plan (HIVE-178) is drawn by `PlanRail`, a 34px rail at the
terminal's right edge. It is a **sibling of the terminal region, never a child**:
`center-stage.tsx` wraps the region in a flex row and mounts the rail as the
row's second child, for a session in a terminal view whose plan has at least
one task. That row, not the region, now carries the fleet table's floor and the
agent view's `hidden`, because it is the column's flex child.

The `plan` slice is **props only**. The composition root reads `usePlan` and the
pin (`usePlanPinned`, `useSetPlanPinned` from `appearance-store`) and passes
them down; nothing under `src/features/plan/` reads a store.

**Peek is CSS, pin is layout.** At rest the rail is one button, labelled with
the whole summary ("Plan, 3 of 7 done"), so its rings are hidden from assistive
tech rather than read twice. Hovering or focusing it shows a 232px drawer —
`absolute right-full` over the terminal, revealed by `group-hover` and
`group-focus-within` — so the terminal's box never changes size and xterm never
refits. Pinning makes the rail itself 232px wide, which the terminal region's
existing `ResizeObserver` answers with exactly one refit;
`tests/e2e/electron/plan-rail.spec.ts` counts both (zero on peek, one on pin),
because happy-dom lays nothing out. The width change animates under
`motion-safe:` only, and so does the in-progress ring's `ccpulse`.

## Home: the strip and the first-run page

Under the comb, `home-strip.tsx` is a `1.4fr 1fr 1fr` grid that keeps its three
columns at every moment. Column 1 is **Needs you** while the Summons queue
(`useSummonsCount(useOnStage())`, the pill's count) is non-empty, oldest wait
first, five rows and a "N more in the Inbox" line; otherwise **While you were
away**, which says so in one dim line when nothing happened. While you were away
is where the Echoes live in round two (HIVE-217): after merged PRs, goals, runs
and ready tickets come checks failed, PRs approved and each clone, every row
only when non-zero, capped at six with a dim "N more". Column 2 is
**Coming up**; column 3 is **Limits** over **Pull requests**. Those three are
not drawn when empty: no scheduled or held work, no metrics, no live PRs. Every
row is `strip-row.tsx`'s one line, never wrapped. Only Needs you rows click:
each opens the Inbox drawer (`useInboxActions().openInboxDrawer`), on its thread
for an ask and at the top otherwise, and so does the more line. Nothing is
answered from Home. The headline over the comb reads the same
`useSummonsCount(useOnStage())`, so the headline, the strip and the pill always
show one number.

`home-page.tsx` swaps comb and strip for `first-run.tsx` while `useProjects()`
is empty: seven breathing empty cells (`animate-ccbreathe`, stilled by the
reduced-motion clamp) and three steps, Add a project, Integrations (Settings on
that pane) and New session, disabled until a project exists.

## Not built yet

Keyboard navigation beyond the global chords in `src/hooks/use-app-chords.ts`,
and simulation mode (see
[`state-and-data.md`](state-and-data.md#simulation-not-built-yet)).
