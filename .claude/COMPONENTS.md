# Components

Read this alongside [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) before any UI task.

Components live in three places, and the boundary between them is lint-enforced:

- `src/components/ui/` — shadcn primitives and Hive atoms. Domain-agnostic.
- `src/components/layout/` — app chrome, the fixed three-column shell.
- `src/components/terminal/` — the terminal. Infrastructure, not a feature.

`src/components/ui/**` and `src/components/terminal/**` may not import from
`src/features/**`. Atoms and the terminal stay domain-agnostic; a component that
needs to know about sessions belongs in a feature slice. `src/components/layout/`
is the exception — the composition root, where feature panels get mounted; see
below.

## shadcn/ui primitives

Only the primitives the UI actually needs are installed. **Do not bulk-install the
library** — every added primitive is code we own and must keep.

| Primitive | Why it is here |
| --- | --- |
| `dialog` | the new-session picker overlay (story 044) |
| `tooltip` | the meta-bar back button (story 040) |
| `dropdown-menu` | model / effort selection (story 044) |

Everything else the concept needs is a Hive atom, because the concept's chrome is
tighter and more terminal-native than shadcn's defaults.

These files are vendored: they are generated output, adapted only where they had
to be. Two adaptations are in place and should be preserved on regeneration:

- Icons come from `@phosphor-icons/react`, not `lucide-react`. The app ships one
  icon library.
- `dialog.tsx`'s footer close control is a plain styled `DialogPrimitive.Close`
  rather than `ui/button.tsx`'s `Button` atom, which postdates it.

## Terminal

### `<TerminalSurface />`

`src/components/terminal/terminal-surface.tsx`

```ts
function TerminalSurface(props: {
  transport: TerminalTransport;
  theme: 'dark' | 'light';
  id?: string;        // opaque; surfaced as data-terminal-id for e2e
  fontSize?: number;  // default 12.5
  readOnly?: boolean; // true everywhere in the prototype
  visible?: boolean;  // hidden instances stay alive
}): JSX.Element
```

One live terminal, fed by a transport and nothing else. It has no idea what a
session is and cannot reach the store — `pnpm lint` fails if it tries.

Container and xterm instance are both held in **state behind callback refs**,
not `useRef`. Two reasons: a ref's `.current` is already populated when the
mount effect runs, making its null-check dead code that erodes the coverage
gate; and holding the *instance* in state is what lets the theme and
subscription effects re-run when a new terminal is constructed, rather than
writing into a disposed one.

`theme` and `transport` are handled by their own effects, so a theme toggle or a
transport swap never destroys scrollback. `fontSize` and `readOnly` are
structural — xterm cannot change `disableStdin` after construction — so they do
rebuild.

### `<TerminalHost />`

`src/components/terminal/terminal-host.tsx`

```ts
function TerminalHost(props: {
  entries: {
    id: string;
    terminalKey: string;
    transport: TerminalTransport;
    readOnly?: boolean;
  }[];
  activeId: string | null;
  endedId?: string | null;
  palette: TermPalette;
  fontFamily?: string;
  fontSize?: number;
  scrollback?: number;
}): JSX.Element
```

`terminalKey` is the React key, so a `/clear` can retire one row and open
another on the pty that is still running. `palette` is resolved colour, not a
theme name — xterm reads colour from JS, never from a custom property.

The kept-alive registry: **one xterm instance per entity, shown and hidden with
CSS**, never one shared instance re-fed on tab switch. Re-feeding would lose
scroll position and selection on every switch. Instances mount lazily on first
visit; ids are opaque here, and the composition root
(`layout/center-stage.tsx`) is what reads the stores and builds the transports.

Full rationale — the seam, colour, fitting, and the bottom-stick rule — is in
[`../docs/terminal-architecture.md`](../docs/terminal-architecture.md).

## Editor

### `<EditorSurface />`

`src/components/editor/editor-surface.tsx` — built.

A CodeMirror 6 instance, fenced exactly like `<TerminalSurface />`: it may not
import `features/`, `data/` or `stores/`, so the composition root reads the
stores and passes values down.

Props: `fileKey`, `value`, `languageLoad`, `readOnly`, `fontFamily`,
`fontSize`, `wordWrap`, `lineNumbers`, `tabWidth`, `onChange`, `onSave`.

- **One view, one `EditorState` per open file.** Cursor, scroll offset and undo
  history all live in the state, so a tab switch is `view.setState(cached)` and
  not a rebuild.
- **A configuration change clears the cache, the active entry included.**
  Extensions are baked in at construction; a state built with the old font would
  keep it and adopt it the moment it was switched to. Getting this wrong makes a
  font change apply to every open file *except* the one on screen.
- **`languageLoad` is a loader, not a resolved language**, so every CodeMirror
  import — including the seventeen dynamic ones — stays inside this directory.
  The document renders before the grammar arrives; that is the point.
- **Colour comes from `--cc-code-*` through `EditorView.theme`.** CodeMirror
  emits real CSS, so the editor follows `data-theme` with no JavaScript. No hex
  literal belongs in this directory.
- **`readOnly` and `editable` are both set.** `readOnly` alone leaves a blinking
  cursor in a document that swallows every keystroke — a hung editor, not a
  read-only one.

## Hive atoms

Each is owned by the story that first needs it. Two are built; the rest are a
contract for their owning story, not existing code.

| Atom | File | Owner | Props | State |
| --- | --- | --- | --- | --- |
| `Chip` | `ui/chip.tsx` | 021 (also 040) | `children: ReactNode`, `tone?: Tone`, `title?: string`, `className?: string` | **built** |
| `Badge` | `ui/badge.tsx` | **021** (also 030, 050, HIVE-182) | `count: number`, `tone?: BadgeTone` (`danger` \| `brand` \| `muted` \| `green`), `text?: string`, `label?: string`, `className?: string` | **built** |
| `Tag` | `ui/tag.tsx` | **052** | `children: ReactNode`, `tone: 'brand' \| 'green' \| 'amber' \| 'red' \| 'subtle'`, `surface?: 'panel' \| 'raised'`, `title?: string`, `className?: string` | **built** |
| `TabBar` | `ui/tab-bar.tsx` | **030** (reused by 050) | generic over `Id extends string`: `tabs: { id: Id; label: string; badgeCount?: number; badgeLabel?: string; badgeTone?: BadgeTone }[]`, `active: Id`, `onSelect(id: Id): void`, `label: string`, `className?: string` | **built** |
| `StatusDot` | `ui/status-dot.tsx` | **030** (used by 031, 032, 041) | `status: SessionStatus \| 'online'`, `pulse?: boolean`, `label?: string`, `className?: string` | **built** |
| `Icon` | `ui/icon.tsx` | **031** (also 033, 051, 053) | `name: string`, `size?: number`, `weight?: IconWeight`, `className?: string` | **built** |
| `KeyHint` | `ui/key-hint.tsx` | 041 (also 043) | `keys: string[]`, `label: string` | planned |
| `SecretField` | `ui/secret-field.tsx` | **HIVE-67** | `label: string`, `value: string`, `onChange(value: string): void`, `onCommit?(): void`, `placeholder?: string`, `hint?: string`, `className?: string` | **built** |
| `SplitHandle` | `ui/split-handle.tsx` | **explorer** | `axis: 'horizontal' \| 'vertical'`, `containerRef: RefObject<HTMLElement>`, `ratio: number`, `onRatio(ratio: number): void` | **built** |
| `Button` | `ui/button.tsx` | **HIVE-118** | `variant?: 'primary' \| 'secondary' \| 'danger' \| 'ghost'`, `size?: 'sm' \| 'md'`, plus `ButtonHTMLAttributes<HTMLButtonElement>` | **built** |
| `SearchBox` | `ui/search-box.tsx` | **HIVE-192** | `label: string`, `value: string`, `onChange(value: string): void`, `onClear(): void` | **built** |

`Badge` moved from story 030 to 021: the header's bell needs an unread count,
and 021 lands first. 030's tab-bar badges reuse it rather than building a second.

Rules for all of them:

- Colour through Tailwind token utilities (`bg-panel`, `text-muted`). **No raw hex
  literals.**
- `StatusDot` pulses via `animate-ccpulse` — never a hand-written keyframe.
- Status is never carried by colour alone; pair the dot with its label.
- Props are the whole API. An atom that reaches into a store is not an atom —
  move it into a feature slice.

Contracts worth knowing before reusing them:

- **`Badge` renders nothing at zero.** Every caller so far means *nothing to see*
  by a count of zero, so the empty badge is never the right answer.
- **`Badge`'s `label` is optional, and its absence is meaningful.** With a label
  it announces `"3 unread notifications"`; without one it is `aria-hidden`
  decoration. Omit it inside an already-labelled control — an ancestor
  `aria-label` replaces its descendants' text outright, so a label there would
  never be announced. The header's bell does exactly this.
- **`StatusDot` follows the same label contract.** With a `label` it announces
  `"lead-form status: needs input"`; without one it is `aria-hidden` decoration.
- **`SecretField` is not a masked `TextField`, and must not become one.** It is
  **write-only**: it never displays a stored value, because the app cannot read
  one back. Its `value` is always a *new* secret on its way in, and what is
  already stored is described in prose beside the field. A `type="password"` prop
  on `TextField` would put a masked box on screen that implies a round trip which
  does not exist. It also sets `autocomplete="off"` and `spellcheck="false"`, and
  carries a reveal toggle so a truncated paste can be caught before saving.
  Omit it wherever a visible status label already sits beside the dot (031); pass
  it where none does (032), so status is never carried by colour alone.
- **`StatusDot` derives its pulse from its status**, so only `working` pulses.
  `pulse` is an override for the rare caller that needs otherwise.
- **`STATUS_LABEL` is exported from `ui/status-dot.tsx`** and owns the
  `waiting → "needs input"` rename. Import it rather than re-deriving it.
- **`TabBar`'s badge reuses `Badge` at `Badge`'s geometry**, not the concept's
  15px/9.5px. One badge geometry with three tones beats a second near-identical
  atom; the 1px difference is deliberate.
- **`Tag` is the third pill, and the three do not overlap.** `Badge` takes a
  `count` and renders nothing at zero, so it cannot carry a word. `Chip` is a
  larger mono pill for dense status text (the header's model chip, the meta
  bar's branch) and has no `subtle` tone. `Tag` is proportional text at badge
  scale, used for the PRs panel's `merged` / `2 open findings` / `checks
  running` row. Reach for a fourth only when none of those three fits — and say
  why here.
- **`Tag`'s ink carries the tone; its fill carries the *surface*.** All five
  tones share one fill, which is what lets four of them wrap in one row without
  competing. Which fill depends on what is behind them: `surface="panel"` (the
  default) is `bg-chip`, and `surface="raised"` inverts to `bg-panel` for a card
  that is itself chip-filled — the PRs panel's live cards, where a chip pill on a
  chip card would leave only floating coloured text.
- **`TabBar`'s `badgeTone` defaults to `muted`.** The left rail's work count is
  an inventory and stays quiet; the activity rail passes `danger` because its
  unread count means the user is what an agent is blocked on (050).
- **`BadgeTone` is exported from `ui/badge.tsx`** and reused by `TabBar`, so the
  two atoms cannot drift to different tone vocabularies.
- **`TabBar` is generic over its id type.** Pass `Tab<LeftTab>[]` and `onSelect`
  hands back a `LeftTab`, not a `string` — no `as` cast at the call site, and an
  id outside the union stops compiling.
- **Set `badgeLabel` whenever you set `badgeCount`.** This is the one place the
  usual "omit the label" advice inverts: a tab is named by its *content*, not by
  an `aria-label`, so an unlabelled badge is `aria-hidden` and its number reaches
  nobody using a screen reader. With it, the tab announces `"Work 8 work items"`.
- **Use the exported `tabId(id)` helper** for a panel's `aria-labelledby` rather
  than re-spelling the `tab-${id}` convention; the atom owns that format.
- **`Icon` bridges the fixtures' icon strings to the React package.** The
  fixtures carry `'ph-slack-logo'` because the concept used the phosphor
  *webfont*; this app ships the React components and no webfont, so `Icon` owns
  the lookup. **A fixture icon name that is not in its `GLYPHS` map renders a
  question mark** — visible in review rather than a silent gap. Adding a fixture
  icon means adding it there.
- **`Icon` is always `aria-hidden`.** Every icon in this app sits beside the text
  it illustrates, so it never announces a duplicate. An icon that must carry
  meaning alone needs a labelled sibling.
- **`STATUS_TEXT` pairs with `STATUS_FILL`** in `ui/status-dot.tsx`: the dot's
  `bg-*` and its label's `text-*` come from the same module, because a dot and
  its label drifting to different colours is the bug that file exists to prevent.
- **`Button` defaults to `variant="secondary"`, `size="md"`, `type="button"`.**
  The default type matters: a bare `<button>` inside a `<form>` submits it,
  which is never what a card's option row means; pass `type="submit"`
  explicitly on the rare button that really should. Its four variants are
  `primary`, `secondary`, `danger` and `ghost`; `primary` is the class string
  already hand-copied into eleven panes (`agents/…/agent-editor.tsx`,
  `projects-section.tsx`, `skill-editor.tsx`, `skills-section.tsx`,
  `env-editor.tsx`, `theme-gallery.tsx`, `clone-repo-view.tsx` ×2,
  `agents-section.tsx`, `new-session-picker.tsx`), lifted unchanged. **Landing
  the atom does not sweep those eleven call sites** — that is separate
  follow-up work, not an endorsement to keep hand-rolling the same string
  elsewhere.
- **`SearchBox` owns only the box.** The explorer, PR and Work rows each keep
  their own second line (mode, scope, count) and pass one `onClear` for both the
  clear button and Escape. Escape on an empty box is left alone, so it never
  takes a key something else wanted.

## Layout

### `<AppShell />`

`src/components/layout/app-shell.tsx` — story 020, built.

```ts
function AppShell(): JSX.Element
```

The fixed three-column chrome: `<Header />` on top, then a row of `<LeftRail />`,
`<CenterStage />`, and `<ActivityRail />`. Takes no props; reads
`useShowActivityRail()` to decide whether the activity rail is mounted at all.

`src/app.tsx` renders `<AppShell />` and nothing else.

The four regions are landmark elements — `<header>`, `<nav>`, `<main>`,
`<aside>` — so tests address them by role. The flexbox contract that holds the
layout together is documented in
[`../docs/component-patterns.md`](../docs/component-patterns.md); do not touch
the `min-h-0` / `min-w-0` / `shrink-0` classes without reading it.

### `<Header />`

`src/components/layout/header.tsx` — story 021, built.

Seven zones, left to right: brand block, model chip (sessions only), spacer,
fleet status counts, theme toggle, inbox bell, New session. 56px tall, `gap-14px`,
`px-4`.

**New session is a split pill** (terminals). The button keeps its exact name
and opens the picker; the chevron beside it is `HeaderTerminalMenu`
(`layout/header-terminal-menu.tsx`), a radix `DropdownMenu` headed
`New terminal in…` that lists every project in config order — never a hand-off
to the picker, which is a session surface. Its trigger is named `Terminal in a project` —
never beginning with "new" — so a locator that finds `New session` by name
still finds exactly one control. Both halves carry `no-drag`.

**The header composes and nothing else.** Every zone that reads domain state owns
its own subscription, so a session changing status repaints one span rather than
the whole bar. Its three sub-components are tested independently; the header's own
tests cover only the wiring.

| Sub-component | File | Reads | Notes |
| --- | --- | --- | --- |
| `BrandBlock` | `layout/brand-block.tsx` | — | pure; 30px tile + `/hive-mark.png` |
| `ModelChip` | `layout/model-chip.tsx` | `useActiveEntity()` | renders `null` unless the active tab is a **session** |
| `StatusCounts` | `layout/status-counts.tsx` | `useCounts()` | derived in the selector, never stored |

Two things here are easy to get wrong:

- **The brand tile uses `bg-brand-fill-strong`, not `bg-brand`.** `--cc-brand` is
  a text colour that flips per theme; using it would repaint the logo tile pale
  blue in dark mode. See the brand-fill note in
  [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md).
- **The model chip's numbers are *observed*, and an unobserved one renders
  nothing at all.** They arrive from Claude Code's own status line payload — see
  `src/lib/session-metrics.ts` and `electron/main/hooks/settings.ts` — and each
  stat carries its own gauge, percentage and separator, so a value nobody has
  reported takes all three away with it rather than holding an em dash in a
  labelled slot. That absence is routine, not exceptional:
  `rate_limits` is missing until a session's first API response and for the whole
  life of an API-key session, and the context percentage is null until the first
  assistant turn. The chip grows as the session reports.

The bell marks everything read rather than opening a dropdown — the inbox lives in
the activity rail (story 051), and two places to read the same list is one too
many.

### `<LeftRail />`

`src/components/layout/left-rail.tsx` — story 030, built.

320px fixed. A flex column of two children: a pinned `<TabBar />` and a scrolling
tab panel that mounts exactly one of `ProjectsPanel` (031), `WorkPanel` (032), or
`AgentsPanel` (033). Reads `useLeftTab()` / `useSetLeftTab()`, plus
`useTicketCount()` for the Work tab's badge.

**The tab bar does not scroll — the panel below it does.** Scrolling the rail as a
whole would push the tabs off-screen as soon as a project tree grew, taking away
the one control the user needs to get back out of it.

Panel state lives in the stores, never in the panels: `collapsed` in the ui-store
is why a collapsed project survives a round trip through the Agents tab even
though the panel unmounts on every switch.

### `<ActivityRail />`

`src/components/layout/activity-rail.tsx` — story 050, built.

316px fixed, and the only region the shell can hide (`showActivityRail`, 020).
Structurally a twin of `<LeftRail />`: a pinned `<TabBar />` over a scrolling tab
panel that mounts exactly one of `InboxPanel` (051), `PrsPanel` (052), or
`ExplorerPanel`. Reads `useRailState()` / `useSetRailTab()`, plus
`useUnreadCount()` for the Inbox badge.

- **The Inbox badge is `danger`, not `muted`.** It is the one count in the app
  that means *you are the blocker*; the left rail's work count is an inventory.
- **Scroll position resets on tab switch.** Story 050 asks for an explicit
  choice. Preserving it per panel means keeping all three mounted or mirroring
  `scrollTop` into the ui-store, and for three short lists neither earns the
  complexity — a stale offset into a list the simulation just prepended to is
  worse than starting at the top.

### `<ActivityBar />`

`src/components/layout/activity-bar.tsx` — HIVE-195, built. No props.

Round two's left edge: a `<nav aria-label="Places">` at `--cc-bar-w`. The brand
glyph on top (Phosphor `Hexagon`, `weight="fill"`, `text-amber`, 22px) carries
the team name as its accessible name and its tooltip, "The Hive" when the name
is empty. Below it the five places — Home, Sessions, Work, Agents, PRs — each a
52px button calling `selectPlace`; the active one has `aria-current="page"`.
Settings sits at the foot and calls `openSettings()`. No Search and no
connection item yet.

### `<ListPanel />`

`src/components/layout/list-panel.tsx` — HIVE-195, built. No props.

Today's panel for the current place, at `--cc-list-w`, in a
`<section aria-label="<Place> list">`: `ProjectsPanel` for Sessions,
`WorkPanel`, `AgentsPanel`, `PrsPanel` (the Hatchery). Home has none, and nothing
renders when `panelOpen` is false, or for PRs while the Hatchery is quiet and no
search is open. Not resizable and no collapsed strip. Each place's own
story replaces its entry.

### `components/layout/` is the composition root

It is the one place under `src/components/` allowed to import `src/features/**` —
the rails and the center stage exist to mount feature panels. `components/ui/` and
`components/terminal/` stay fully fenced. See AGENTS.md → Import zones;
`pnpm verify:boundaries` proves both halves.

## Feature panels

### `<ProjectsPanel />`

`src/features/projects/components/projects-panel.tsx` — story 031, built.

A collapsible tree: `ProjectsPanel` → `ProjectRow` → `SessionRow | TerminalRow`
(per live entity, by kind). The panel itself holds no state and reads no
session data — **each row owns its own subscription**, so one session changing
status repaints that row rather than the whole tree.

Four things here are easy to get wrong:

- **The count pill is a plain span, not `Badge`.** `Badge` renders nothing at
  zero, and a project with no live sessions must still show its `0` — that is the
  story's empty state, and losing the pill would read as a rendering bug.
- **Both rows are `<button>`s, not divs with `onClick`.** The project row carries
  `aria-expanded`; the session row carries `aria-current` when its tab is open.
  Keyboard reachability comes free that way.
- **`SessionRow` renders `null` for an id the store does not know.** The
  simulation (061) and the spawn flow (044) both mutate entities underneath open
  panels, so a row that assumes its entity exists is a race waiting to throw.
  `TerminalRow` does the same, and also for a row of the wrong kind.
- **The last child is a split row.** `NewSessionLink` on the left,
  `NewTerminalLink` on the right; the terminal link is named `Terminal in
  <project>` on purpose, so no locator that begins `New session` matches it.

`collapsed` lives in the ui-store rather than in `ProjectRow` because the panel
unmounts on every left-rail tab switch; component state would forget the tree.

### `<WorkPanel />`

`src/features/work/components/work-panel.tsx` — story 032, built.

`WorkPanel` → `TicketCard` → `TicketSessionRow` / `TicketPrRow`. The same fleet the
projects panel groups by repo, grouped by work item instead.

- **The PR section — divider included — is omitted when no linked session has a
  PR.** A rule with nothing under it reads as a rendering bug.
- **`TicketSessionRow` passes `StatusDot` a `label`**, unlike the projects panel:
  these rows carry no visible status text, so without one the dot would convey
  status by colour alone.
- **A PR row opens the owning session's terminal when there is a live one, and
  the PR on GitHub when there is not.** A PR has no tab of its own in this app,
  and `Pr.session` is `null` unless a *live* session sits on the branch — which
  for anything merged in the last day it usually does not.

`useTicketPrs()` filters the live `prs` list by the branches the ticket's
sessions are on. It used to walk `Session.pr` instead, with the global list as a
fallback; nothing ever wrote that field, so the section was permanently empty and
only the fixtures made it look otherwise. (The field itself is gone as of
HIVE-100, which found the last two surfaces still reading it — the fleet table's
`PR` column and the meta bar's chip, both empty for the same reason.) It **cannot use
`useShallow`** — it builds new objects, and `useShallow` compares an array's
elements by identity, so every render would produce a new snapshot and React
would loop. It subscribes to the stable slices and memoises instead; the
resolution itself is the exported pure function `resolveTicketPrs()`.

Colour and findings wording live in `src/features/shared/pr-presentation.ts`,
because the PRs panel (052) is a separate slice that must agree with this one.

### Round two's Work: `<TicketRow />`, `<WorkStage />` / `<TicketPage />`, `<TicketPageConversation />`, `<TicketProperties />`

`src/features/work/components/`, HIVE-203.

- **`WorkPanel variant="rows"`** (`WorkList`, what `ListPanel` mounts for
  Work) swaps Classic's cards for a header (`N tickets · N need you`, a search
  toggle) and groups of `TicketRow`s with fold carets. Skeleton, notices, pull
  to refresh and both pollers are shared with the cards.
- **`TicketRow`** — a tone dot, the title without its tags, and `KEY · fact`
  in mono. The fact and tone are `lib/ticket-activity.ts`'s, pure and tested
  rule by rule. `aria-current` marks the open ticket.
- **`WorkStage`** — what `CenterStage` renders for the `'work'` view: "Pick a
  ticket", else `TicketPage` keyed by the ticket so each open starts fresh.
- **`TicketPage`** — content (header, description, conversation) beside a
  260px properties column. It loads on open and mounts a 60 s poller; a status
  change re-reads the transitions. A failed section shows its message and
  Retry (`ticket-page-parts.tsx`); content already shown stays, "as of HH:MM".
- **`TicketPageConversation`** — Comments | Everything over the slice's
  comments and `useTicketEvents`. A comment's time sits in a fixed 120px slot
  that Reply and Copy link take over on hover or focus, so nothing shifts. The
  reply box posts through `addJiraComment` and appends; a refusal is amber and
  keeps the draft.
- **`TicketProperties`** — `useTicketProperties`' rows (a row without a value is
  left out), the ticket's sessions and PRs, and New session, Move to the next
  status, Open in Jira.
- **`TicketTab`** / **`TicketConstellation`** — HIVE-202: the session panel's
  Ticket tab (`ticket-tab.tsx`): header, acceptance criteria or description,
  latest comment, Links (verdict, constellation, a row per arc) and the footer
  with Open the ticket ›. The layout is `constellation.ts`'s numbers, the arcs and
  verdict `lib/ticket-links.ts`'s; the component draws them. It loads with
  `want: 'tab'` and polls once a minute while mounted, after its first load.

### `<AgentsPanel />`, `<AgentRow />` and `<AgentTile />`

`src/features/agents/components/` — stories 033 and HIVE-114, regrouped by
HIVE-116, into lanes by HIVE-204.

`AgentsPanel` → a header ("Agents", then `N summons` in amber and `N morphing`
in green, each omitted at zero, then a + button labelled "New agent") → one
`section` per lane, named by `aria-label` → a lane header (a chevron button
with `aria-expanded`, a 9px square in the lane's colour, the label and the
count) → `AgentRow`. The lanes are **Summons** (asking, failed or invalid),
**Morphing** (working) and **Burrowed** (sleeping, then paused). Every ordering
rule lives in `useAgentsByGroup` — asking first inside Summons, then the most
recent run; sleeping before paused; empty lanes omitted — so the panel renders a
decision rather than making one. Folds are `agentsFolded` in ui-store, all open
by default. In code a lane is a `group`: `lane:` is an agent frontmatter key.

`+ New agent…` at the foot and the header's + both open a never-saved agent page
on Definition (`openAgentPage(null, 'definition')`).

`AgentTile` is the row's 38×40 hexagon: an inline SVG polygon stroked in the
state's colour (asking amber with a 22% fill and a soft glow, failed red with a
14% fill, working green, resting subtle, invalid amber outline), the agent's
`Icon` inside, and a live-run badge only past one. Fills go through
`color-mix` on the `--cc-*` token. It is `aria-hidden`.

`AgentRow` is the tile and two lines. Line 1 is the name and a fixed 44px slot
showing the age (`ageLabel`, through `useAge`) of line 2's entry. Line 2 is the
agent's last word on the ledger (`useAgentLastWord`): the kind as a coloured
mono keyword (`ask a3` amber, `failed` red, `event` brand, `post` subtle, `done`
green) and the entry's first line; `invalid` and its reason beat it, and a
paused agent that never wrote says `paused`. On hover or focus Run now and
Pause (Resume) show over the slot, as siblings of the row button so each keeps
its own tab stop. An answer that is not a start takes line 2 for five seconds,
amber, `role="status"`. The row button's accessible name says the state, the
live runs and the last word, so the tile's colour is never the only carrier.

### `<AgentView />`, `<AgentRunLog />` and `<AgentLedger />`

`src/features/agents/components/` — HIVE-116, built.

An agent's place on the centre stage, and **deliberately not a terminal**:
nothing is typed into a process, and the log is a transcript of turns that have
already ended. It keeps the terminal's rhythm — header, body, one input at the
bottom — and that is the whole of the resemblance.

Header, five fact tiles, then the two regions side by side, then the input. The
split is `minmax(0, 1fr) clamp(280px, 22%, 380px)` under a **container query**
that stacks below an 800px stage. Both halves of that are load-bearing and both
are argued in `docs/agents-and-ledger.md`; the short version is that the log is
elastic because it renders at the user's terminal type scale, `1fr` alone would
give the app a horizontal scrollbar, and the rails drag so only the container
knows how wide the stage is.

`AgentRunLog` takes its colours from the theme's terminal palette in JS, the way
the xterm surface does — those four values already exist and are already
themeable, and a `--cc-run-*` group would be a second copy of them. Finished
runs are one-line receipts with no chevron: their lines were never kept.

`AgentLedger` stacks each entry's kind chip and timestamp **above** its body,
because an inline chip costs 44px of a 280px column. All nine `LedgerKind`
members get a chip. An open ask draws no option buttons — that control is
HIVE-118's, and until it lands the input below is the way to answer.

### `<InboxPanel />` and `<NotificationCard />`

`src/features/inbox/components/` — story 051, built.

A stack of notification cards, newest first, from `useNotifs()`.

- **Clicking a card does two things**: `openTab(notif.target)` and
  `markRead(index)`. Navigating without marking read would leave both badges
  lying about what is still waiting; marking read without navigating would lose
  the thread. This is the entry point of the payoff loop (043) — one click from
  "something needs you" to the terminal showing the amber prompt.
- **`markRead` addresses a notification by index**, so the panel passes the array
  position down even though the card renders from the object.
- **Cards are keyed by content, not index.** The simulation prepends; an index
  key would make React reuse the top card's DOM for a different notification.
- **Unread is carried by fill *and* a visually hidden "unread"**, because the
  count that fill implies is the whole point of the red tab badge, and colour
  alone puts it out of reach of a screen reader.
- The store caps the list at 8 (`NOTIF_CAP`); the panel renders what it is given.
- **A card carrying a `link` grows a wrapper, and the exit moves with it**
  (HIVE-123). `notif.link` renders as a real `<a>`, and an anchor inside a
  `<button>` is interactive content inside interactive content — so the link is
  the button's *sibling* under a wrapping `<div>`, the way `session-table.tsx`
  draws its row action. The card's dismissal — `overflow-hidden`, the measured
  `--cc-card-h`, `animate-ccslideout` and the list's own `mb-*` — then belongs
  to that wrapper rather than to the button: left on the button, the link and
  the margin below it held full height while the button collapsed, and the list
  jumped when the remainder unmounted.

### The Hatchery: `<PrsPanel />`, `<PrRow />`, `<Flap />`

`src/features/pull-requests/components/` — HIVE-205, built (replaced story 052's
`<PrCard />` and its badge row).

One two-line row per PR from `useHatchery()` (HIVE-215's order: SUMMONS first),
under a header that says `N open · M need you`.

- **Merged PRs fold under `HATCHED · N · last 24h`**, folded by default
  (`prsFolded` in the ui-store), drawn only when something merged.
- **Search is the header's icon**, shown only while the sweep is live (a search
  needs `gh`). It opens `PrSearchRow` with the box focused (`focusOnMount`, an
  effect, since jsx-a11y bans `autoFocus`); a search replaces the rows with
  `useHatcherySearch()`, by the same flap rules. Closing it clears it.
- **Rows are memoised by value** (`PrRow`'s `sameRow`) and keyed by
  `prKey(owner, repo, n)`; `onOpen` is a stable callback and `open` a string
  comparison, so a ledger append that names no PR re-renders no row.
- **The flap turns only when its word changes** between two renders of the same
  row: never on mount, so never on first render, a fold or a search. SUMMONS
  pulses. Under `useReducedMotion` it neither turns nor pulses.
- **Round two opens the page** (`openPrPage`); **Classic opens GitHub**, since the
  Classic rail has no page.

### The PR page: `<PrPage />`, `<ShipTrack />`, `<PrConversation />`, `<ThreadCard />`, `<PrProperties />`, `<PrCommentBox />`

`src/features/pull-requests/components/` — HIVE-205, built. `<PrsStage />` picks
what the stage shows: the empty Hatchery, the page for `useOpenPr()`, or "Pick a
pull request" while the sweep is not live.

- **The detail is polled** once a minute through its own `createPoller`; the page
  is keyed on the PR, so opening another is a new mount and a fresh read. A
  failed refresh keeps the last detail with the problem above it.
- **`PR_TABS` is the tab list** (Conversation, Files, Checks, Timeline); a stored tab this
  page does not have falls back to Conversation in the page, not in the store.
- **The ship track** is `bandStops()` over PR 1's `shipTrack`: the shipper's
  eight stops while it holds the PR, all eight ticked once merged after it ran,
  else the short Draft · Open · Review · Merge from GitHub's state.
- **A merged PR is read-only**: no comment box, and the actions are GitHub alone.
- **Merge answers the shipper's merge card** (`useMergeAsk`) with `allow-once`,
  the same answer the Inbox card's narrowest rung sends, and is disabled until
  that card exists. One ledger write at a time; a refusal or a failed call shows
  inline in amber. No `gh` write is added.
- **Nothing from GitHub is HTML.** Bodies and comments go through `<Markdown />`
  (`src/features/shared/components/markdown.tsx`): `marked`'s lexer to React
  elements, raw HTML as text, links only for `http(s):` and `mailto:`.

### The Files tab: `<PrFiles />`, `<PrFileTree />`, `<PrDiff />`, and `<ThreadCard />`'s writes

`src/features/pull-requests/components/` — HIVE-207, built. The tab strip's Files
entry carries the changed-file count ("Files 9") once the detail is read.

- **`<PrFiles pr detail fixerOnIt onOpenFile? />`** (`pr-files.tsx`) lays the tree
  beside the selected file's diff and reads the diff at `detail.headSha`, so the
  page's 60s detail poll moving the head re-reads it. A stored `prFile` no longer
  in the list falls back to the first file with an open thread, in render. A
  missing `prDiffs` entry reads as loading; a failed re-read keeps the old text
  under the problem.
- **`<PrFileTree detail selected onSelect />`** (`pr-file-tree.tsx`): "Filter
  files", the "9 files · 2 open threads · viewed 3 of 9" summary (plus a GitHub
  link when GitHub sent fewer files than changed), folders by their directory, and
  a row per file with its thread mark, viewed check or "changed", and +/−.
- **`<PrDiff file diff threads problem? loading? prUrl readOnly onViewed onOpenFile? writes? fixerOnIt />`**
  (`pr-diff.tsx`): the header (path, +/−, Viewed, Unified | Split, Open in the
  editor) and plain mono rows with no highlighting, each thread under the line it
  is about and outdated ones on top. Viewed is optimistic through the store and
  disabled while its write is pending and on a merged PR.
- **`<ThreadCard writes? />`** gains `writes?: ThreadWrites`: Reply (a box under
  the thread), Resolve and Unresolve, not optimistic, the reason inline on a
  refusal. `useThreadWrites(pr)` builds it for Conversation and Files, and
  answers none on a merged PR.

**The Checks tab** (`pr-checks.tsx`, HIVE-206). It mounts its own 60s poller,
so runs and jobs are read only while it is shown.
- **`RunBar`**: the shown run, its sha and age; the last eight pushes as 9 × 14 squares (a click shows that push); a chip per workflow file.
- **`ChecksGraphView`**: `layoutGraph`'s boxes (160 × 48) and edges.
  - Edges take their target's state, and an edge into a running job flows (`animate-ccflow`, still under reduced motion).
  - A matrix box opens into its legs.
- **The non-Actions checks** are a row of chips with links out.
- **`JobSteps`** is the shown job, with Re-run failed, Open the log, and "<holder> has it" (`holderIcon`). **`JobLog`** shows the cut log, toned by `classifyLogLine`.
- **No runs and no other checks** reads "No checks on <sha>".
- A tab can carry `SegmentedOption.alert`, a red dot that reads ", failing".

### The Timeline tab: `<PrTimeline />`, `<TimelineLane />`, `<TimeBuckets />`

`src/features/pull-requests/components/` — HIVE-208, built. Derivation is
`src/lib/pr-timeline.ts`; the component only draws `useTimelineModel`.

- **`<PrTimeline pr />`** (`pr-timeline.tsx`) mounts its own 60s poller, so the
  read runs only while the tab is shown. It draws a skeleton until the first read, a
  `SourceProblem` with Retry when that fails, and the problem above the lanes when a
  refresh fails. Six lanes (Flap, Commits, CI, Reviews, Comments, Agents), the tick
  row, a green "now" line while the PR is open, and `<TimeBuckets />` below.
- **`<TimelineLane label marks height? />`** (`timeline-lane.tsx`): a 130px label
  gutter (`GUTTER`; the axis, ticks and now line share it via `axisLeft`), lanes 52px
  high, the Flap lane 40px. `LaneMark` is `{ key, from, to?, shape, tone, word?, tip, onOpen }`:
  `from`/`to` are 0..1 on the axis, `tone` comes from a fixed class table, never
  built from data, and `word` is drawn inside a span only when it fits.
- **Marks are buttons** (`aria-label` is the tooltip text). One tooltip per lane
  shows on hover and on focus, so focus equals hover, and Enter is a native click.
- **Mark sizes:** flap 22px band; commit a 10px ring; CI bar 12px; review a 12px
  diamond (amber when it asks for changes); comment a 12 × 11px bubble; hold a 20px
  pill. Colours are tokens: green/red CI, brand for commits and comments,
  chitin for holds, amber for reviews that wait on you. MUTATING is green stripes.
- **Where each mark lands:** a CI bar opens Checks on its push (`showPrRun(sha)`);
  a commit opens GitHub in a new tab; a review, comment, flap or hold calls
  `focusPrEvent` and the Conversation scrolls to it (the ledger events by `e-<id>`,
  GitHub's by `r-<url>` / `c-<url>`). A flap or hold with no ledger event falls back to
  the Conversation tab, a hold to Everything.
- **`<TimeBuckets age buckets sentence />`** (`time-buckets.tsx`): "Where the 3h 20m
  went", one stacked bar of up to six buckets sized by time (a 24-minute floor so
  none vanishes), and the sentence. `dur` is the tab's one duration format.

### `<EmptyHatchery />`

`src/features/pull-requests/components/empty-hatchery.tsx` — HIVE-205, built.

When the sweep is live and empty the list panel draws nothing (unless a search
is open) and the stage shows a dormant egg on the creep, in tokens only. Search
older PRs opens the panel with the search; New session opens the picker. Under
reduced motion every animation class is dropped: the crack stays closed and no
spores are drawn. The panel slides in (`animate-ccslidein`) only on the quiet →
listed change, never on mount.

### `<ExplorerPanel />` and `<TreeNode />`

`src/features/explorer/components/` — built.

A lazy tree of the active session's repository. Replaced `<ActivityFeedPanel />`,
which rendered fixture rows narrating events the app already shows elsewhere.

- **The root follows the session**, through `useExplorerProject()`. There is no
  project picker: the app is already organised around "which session am I
  watching", and a second selector would be one more thing to keep in sync with
  the first. The orchestrator tab falls back to the last project the tree was
  rooted at.
- **A collapsed directory is never read.** Each expanded node owns its own
  `useDirectory()` call, which is what makes opening a repository cheap.
- **The whole row is a `<button>`**, like `ProjectRow` — reachable by keyboard,
  with `aria-expanded` on directories and `aria-current` on the open file.
  Indentation is *padding on the button*, not a nested container, so the hover
  and selection backgrounds run the full width of the rail rather than being
  inset one level per depth.
- **Not a `role="tree"`.** A real ARIA tree needs roving tabindex, typeahead and
  arrow-key navigation across the whole widget to be correct; a half-built one
  announces capabilities that are not there. This is a list of buttons that all
  work, and full tree semantics are a deliberate follow-up.
- **It does not own the filesystem watcher.** That is `useProjectWatcher` at the
  composition root: an open editor buffer reconciles against the same events and
  outlives the rail tab. The panel reads the revision counter the watcher bumps.

### `<EditorPane />`, `<EditorTabStrip />` and `<EditorNotice />`

`src/features/editor/components/` — built.

The centre stage's document half: the strip of open files, the notices for when
the disk and the buffer disagree, and the CodeMirror surface itself.

- **The strip is stage chrome, not editor chrome**, and carries a Terminal entry
  exactly when the terminal is hidden — full-stage placement only.
- **The dirty dot sits inside the label, not in place of the ×.** Swapping the
  close control for a dot moves it at exactly the moment you most want to close
  a tab deliberately.
- **Notices are amber, never red.** An agent rewriting a file under you is the
  entire point of the app, not a failure.

### `<PlanRail />` and `<PlanGlyph />`

`src/features/plan/components/` — HIVE-181, built. The plan panel: a 34px glyph
rail mounted by `center-stage.tsx` beside the terminal region (a sibling, never
inside `components/terminal/`). Props only — `plan`, `pinned`,
`onPinnedChange` — so the slice reads no store; the composition root passes
`usePlan` and `appearance-store`'s pin. `PlanGlyph` is one task's 16px ring:
numbered on `border-term-track` while pending, green and `ccpulse` while in
progress, a filled `bg-green` check when done, "proposed" for a plan-mode task.
The drawer peeks over the terminal by CSS (`group-hover`, `group-focus-within`)
and docks at 232px when pinned. See `docs/component-patterns.md`, *The plan
rail*.

### Region placeholders

Still bare panels, owned by the story that fills each in.

| Region | File | Filled in by |
| --- | --- | --- |
| `CenterStage` | `layout/center-stage.tsx` | 040 — view-state machine, session meta bar |

`ActivityRail` is no longer a placeholder — story 050 filled it in; see below.

`CenterStage` mounts `<TerminalHost />` and builds one `StaticTransport` per
entity, cached for the life of the app — transport identity matters, because a
surface resubscribes whenever its transport changes. Which of the four states it
renders comes from `resolveView()` in `src/lib/resolve-view.ts`.

Two covers are drawn *over* the live surface rather than instead of it, so the
terminal underneath stays mounted and keeps its scrollback: `SessionBootCover`
while a session's agent is starting, and `TerminalEndedCover` — a strip along
the foot, because the transcript above it is the evidence — when a terminal's
shell died unasked. A terminal the user exited is removed outright and has
nothing to cover.

### `<SessionMetaBar />`

`src/components/layout/session-meta-bar.tsx`

```ts
function SessionMetaBar(props: { entity: Session }): JSX.Element
```

The bar above the terminal in the **session** view (040): a back pill, the
entity id, its one-line task, status chips — branch, status, and PR — and, at
the right end, `terminal here` (terminals): a shell at the session's observed
`cwd`, not the project root. Named `Terminal here in <id>`; its chord `⌃\``
is one of the three in `hooks/use-app-chords.ts`, a small table that shares the
window-keydown and terminal-chord-event entry points across the rail-collapse
chords and this one. On a terminal tab, which has no bar, the chord opens a
sibling.

It took an `Entity` and rendered a `dedicated agent` chip for the other kind
until HIVE-116, which gave agents a view of their own. The prop narrowed to
`Session` with the branch that drew those chips: a type that admits what the
component can no longer draw is an invitation to reach it again.

Everything is derived from the entity, so a status change reaches this bar the
same moment it reaches the rails — including the `waiting → "needs input"`
rename, which comes from `STATUS_LABEL` rather than being spelled again here.
PR colour comes from `features/shared/pr-presentation`, shared with the work and
PRs panels.

**The PR chip is resolved, not read off the entity, and it is a link** (HIVE-100).
It used to render `entity.pr` — a field nothing has ever written, so the chip had
never once appeared outside a fixture and the "derived from the entity" sentence
above was describing something that could not happen. `useSessionPr()` matches
the session's branch against the live `prs` list, the same resolution
`useTicketPrs()` and `usePrs()` perform; `Session.pr` is gone, along with the
`PrState` type that existed only to type it.

The back pill uses a native `title` rather than the Radix tooltip: this predates
`TooltipProvider`, now mounted in `app.tsx` for the rail strips' hover labels,
and a title still does everything this one affordance needs. The label names
the shortcut story 060 will bind.

### Feature components (epic HIVE-4)

| Component | File | Story |
| --- | --- | --- |
| `SessionTable` | `features/orchestrator/components/session-table.tsx` | 041 |
| `ConsoleInput` | `features/orchestrator/components/console-input.tsx` | 041 |
| `MessageInput` | `features/sessions/components/message-input.tsx` | 043 |
| `NewSessionPicker` | `features/sessions/components/new-session-picker.tsx` | 044 |
| `OptionStepper` | `features/sessions/components/option-stepper.tsx` | 044 |

`OptionStepper` is bespoke rather than a shadcn primitive — nothing else uses it
— but exposes `radiogroup`/`radio` roles, because that is what the four options
*are*. `NewSessionPicker` composes `radix-ui`'s Dialog directly rather than the
vendored `DialogContent`, which always portals to `document.body`; the picker
fills the center stage instead. Radix's focus trap, Escape, scroll lock, and
`aria-modal` are all retained.

### `<SlackGroup />`

`src/features/settings/components/slack-group.tsx` — Settings › Integrations,
HIVE-123. Design record:
https://claude.ai/code/artifact/efe48323-a347-4744-8c00-026f8ff086b8

One `SettingsGroup` (`src/features/shared/components/settings-group.tsx` since
HIVE-204, beside `InlineConfirm` and the shipped marker, so the agents slice can
use them too) — a status row (state pill · identity · actions), a
hairline, then one caption line and an `Advanced` disclosure closed by
default. Chosen over the two alternatives considered (mirroring Jira's three
nested groups, and a connection card), both of which cost roughly three times
the height to say one sentence.

- **The state pill** (`off` / `ok` / `wait` / `err`) collapses `SlackStatus`'s
  five `kind`s down to four — `not-added` and `needs-auth` read identically,
  both "sign in again" (`pillKindOf`).
- **The caption is one slot with a strict precedence** — an error message,
  else the approval sentence, else the Used-by summary — never two at once.
  That is what lets `pending-approval` and a failed sign-in fit without a
  fourth block; `Caption` is the one place the decision gets made.
- **Only two fields off `AgentSummary` are read**: `name` and `tools` — the
  Used-by line and the `grantsSlackTools` hint. `SlackGroupAgent` is typed
  narrower than the full summary on purpose; `AgentSummary` is structurally a
  superset, so `integrations-section.tsx` passes it straight through.
- **A broken bridge is reported, not swallowed.** `readSlackStatus` / `signIn`
  / `signOut` / `testSlack` (`src/lib/slack.ts`) all return `null` when the
  IPC call cannot reach main; the group turns that into an `error`-kind status
  rather than rendering nothing, the same choice `JiraCredentialGroup` makes
  for a failed Jira verb.
