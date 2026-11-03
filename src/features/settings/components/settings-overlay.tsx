import { CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from 'react';

import { cn } from '@/lib/utils';
import type { SettingsSection } from '@/types/settings';

import { AdvancedSection } from '@features/settings/components/advanced-section';
import { AgentsSection } from '@features/settings/components/agents-section';
import { AppearanceSection } from '@features/settings/components/appearance-section';
import { ClisSection } from '@features/settings/components/clis-section';
import { EditorSection } from '@features/settings/components/editor-section';
import { IntegrationsSection } from '@features/settings/components/integrations-section';
import { NotificationsSection } from '@features/settings/components/notifications-section';
import { ProjectsSection } from '@features/settings/components/projects-section';
import { RuntimeSection } from '@features/settings/components/runtime-section';
import { SkillsSection } from '@features/settings/components/skills-section';
import { useSettingsActions, useSettingsSection } from '@stores/ui-store';


/**
 * The settings overlay (story 101).
 *
 * ## Why the Radix primitive rather than `components/ui/dialog`
 *
 * The same reason the new-session picker gives (story 044): the vendored
 * `DialogContent` always portals to `document.body` and centres a fixed card.
 * Settings fills the **center stage** — the panels and session header stay visible — so
 * it is composed from the primitive directly and rendered in place. The parts
 * that matter are kept: the focus trap, Escape, and the `aria-modal` semantics
 * that hide the rest of the tree from assistive tech.
 *
 * Not kept: scroll locking, and no `Dialog.Overlay`. A scrim across the whole
 * app would destroy the full-stage look, and the shell is a fixed-height,
 * non-scrolling layout, so there is no page scroll to lock.
 *
 * Not a modal for a second reason too: a dialog floating over thirteen live
 * terminals fights the attention model the app is built around, and this
 * surface needs room for a section list.
 */

/**
 * The nav, in groups (HIVE-374, Epic HIVE-373).
 *
 * Six groups in the epic's order: Harnesses, Automation, Workspace, Machines,
 * Account, General. A group heading is a label, never a button. A group with
 * no pane yet is simply not listed — Machines and Account arrive with their
 * panes — the same rule that keeps a pane **absent rather than disabled** until
 * it exists: a nav full of dead items teaches the user that settings are broken.
 *
 * Adding a pane is still a row here and an entry in `PANES`, and no control
 * flow anywhere in this file.
 *
 * The CLIs and Runtime panes keep their labels until HIVE-376 and HIVE-377
 * replace those sections; their ids already name what replaces them.
 *
 * Advanced sits last. It answers questions about the app rather than setting
 * anything in it, and the destructive verb in the product lives there.
 */
const GROUPS: readonly {
  group: string;
  panes: readonly { id: SettingsSection; label: string }[];
}[] = [
  {
    group: 'Harnesses',
    panes: [
      { id: 'harnesses-overview', label: 'CLIs' },
      { id: 'shell', label: 'Runtime' },
    ],
  },
  {
    group: 'Automation',
    panes: [
      { id: 'agents', label: 'Agents' },
      { id: 'skills', label: 'Skills' },
    ],
  },
  {
    group: 'Workspace',
    panes: [
      { id: 'projects', label: 'Projects' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'editor', label: 'Editor' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'notifications', label: 'Notifications' },
    ],
  },
  { group: 'General', panes: [{ id: 'advanced', label: 'Advanced' }] },
];

/** Every pane in nav order, for the arrow keys, which cross group lines. */
const ORDER = GROUPS.flatMap((entry) => entry.panes.map((pane) => pane.id));

const groupOf = (id: SettingsSection): string =>
  GROUPS.find((entry) => entry.panes.some((pane) => pane.id === id))?.group ?? '';

/** Arrow keys move one pane and hold at the ends; Home and End jump to them. */
function step(current: SettingsSection, key: string): SettingsSection | null {
  const index = ORDER.indexOf(current);

  switch (key) {
    case 'ArrowDown':
      return ORDER[Math.min(index + 1, ORDER.length - 1)] ?? null;
    case 'ArrowUp':
      return ORDER[Math.max(index - 1, 0)] ?? null;
    case 'Home':
      return ORDER[0] ?? null;
    case 'End':
      return ORDER.at(-1) ?? null;
    default:
      return null;
  }
}

/*
  Derived from the shared union rather than declared here: `ui-store` has to
  name a pane to honour `openSettings('agents')` and may not import a feature
  slice, so the vocabulary lives in `@/types/settings` and this list is checked
  against it. A pane added below without a member there does not compile.
*/
type SectionId = SettingsSection;

/**
 * Section id → pane, the same shape `list-panel.tsx` uses for its panels.
 *
 * A map rather than a chain of ternaries: adding story 104's section should be
 * two lines and no control flow.
 */
const PANES: Record<SectionId, ComponentType> = {
  projects: ProjectsSection,
  shell: RuntimeSection,
  'harnesses-overview': ClisSection,
  skills: SkillsSection,
  agents: AgentsSection,
  appearance: AppearanceSection,
  editor: EditorSection,
  integrations: IntegrationsSection,
  notifications: NotificationsSection,
  advanced: AdvancedSection,
};

/**
 * Has some control inside this overlay claimed Escape for itself?
 *
 * ## Presence, not focus
 *
 * This used to ask only whether the *event target* sat inside an escape scope,
 * which was correct only because the focus trap guaranteed focus was still
 * inside the overlay. The overlay is not modal any more — it leaves the header
 * and rails live — so a keyboard user can Tab out to the header with a rename
 * editor still open. Escape pressed there has a target outside every scope, the
 * guard would decline to fire, and the overlay would close and discard the
 * edit: exactly the loss `data-escape-scope` was added to prevent.
 *
 * The marker lives on the claiming control itself and unmounts with it, so its
 * presence anywhere is the signal. That keeps the property the attribute was
 * chosen for — the overlay learns that Escape is spoken for without learning
 * who spoke for it.
 *
 * Exported for its test: this is a document query inside a Radix callback, and
 * the branch that matters is the one where focus has already left.
 */
export function escapeIsClaimed(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;

  if (el?.closest?.('[data-escape-scope]')) return true;

  return document.querySelector('[data-escape-scope]') !== null;
}

export function SettingsOverlay() {
  const { closeSettings, clearSettingsSection } = useSettingsActions();

  /**
   * Component-local, deliberately not `ui-store`.
   *
   * Settings open on Projects unless the caller *named* a pane. The realistic
   * route in is the picker discovering it has no projects to offer (story
   * 101), and reopening onto whichever pane was last visited would strand
   * exactly that user in Appearance with no idea where the thing they came for
   * went. A caller that asked for a pane — the rail's `+ New agent…`
   * (HIVE-116) — is a different case: it is answering a question the user just
   * asked, and landing them on Projects would lose it.
   *
   * The request is honoured on arrival, not only at mount. This overlay is
   * `modal={false}` precisely so the panels stay live underneath it, so
   * `openSettings('agents')` can fire while it is already open — and reading
   * the request once made that click do visibly nothing. The effect below
   * consumes each request exactly once, which is what keeps a stale value from
   * yanking the pane back after the user has navigated on.
   */
  const requested = useSettingsSection();
  const [section, setSection] = useState<SectionId>(requested ?? 'projects');

  /**
   * Which half shows below the two-column breakpoint (HIVE-374): the group
   * list, or one pane full width with a back control. Above it both show and
   * this is ignored, so it can be set freely. A named pane opens on that pane;
   * a bare open on the list, the way Projects is the wide default.
   */
  const [paneOpen, setPaneOpen] = useState(requested !== null);

  useEffect(() => {
    if (requested === null) return;

    setSection(requested);
    setPaneOpen(true);
    clearSettingsSection();
  }, [requested, clearSettingsSection]);
  const Pane = PANES[section];

  const navRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const groupId = useId();

  /**
   * Narrow, opening a pane hides the list and Back hides the pane, so the
   * focused control vanishes with its half and focus falls to the body. Each
   * user move names where focus goes next, and this hands it over once the
   * other half has rendered. Wide, the back control is itself hidden, so
   * focusing it does nothing and focus stays on the clicked row. A pane a
   * caller named moves nothing: no user move set a target.
   */
  const handoff = useRef<'back' | 'nav' | null>(null);

  useEffect(() => {
    const target = handoff.current;
    handoff.current = null;

    if (target === 'back') backRef.current?.focus();
    if (target === 'nav') {
      navRef.current?.querySelector<HTMLElement>(`[data-pane="${section}"]`)?.focus();
    }
  }, [paneOpen, section]);

  const openPane = (id: SectionId) => {
    if (!paneOpen) handoff.current = 'back';
    setSection(id);
    setPaneOpen(true);
  };

  const backToList = () => {
    handoff.current = 'nav';
    setPaneOpen(false);
  };

  /**
   * One tab stop, roving: the current pane is the only button Tab reaches.
   * The arrows select as they move, which opens the pane beside the nav when
   * it is wide; narrow, the list stays up and Enter opens what is focused.
   */
  const onNavKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = step(section, event.key);
    if (next === null) return;

    event.preventDefault();
    setSection(next);
    navRef.current?.querySelector<HTMLElement>(`[data-pane="${next}"]`)?.focus();
  };

  return (
    <DialogPrimitive.Root
      open
      /**
       * Not modal, and not for a11y-purity reasons — because it was breaking
       * the header.
       *
       * This overlay fills the **center stage** and deliberately leaves the
       * header and both rails on screen. Radix's default modality then marked
       * that visible chrome `aria-hidden` and gave it `pointer-events: none`,
       * so the theme toggle, the notification bell, New session and every rail
       * tab looked live and did nothing. Clicking one dismissed the overlay
       * instead of acting, which is why toggling the theme from here needed two
       * clicks — the first was spent closing settings.
       *
       * Visible chrome that ignores the pointer is the worst of both designs. A
       * real modal would have to dim the surroundings to earn that; this is a
       * stage *view*, closer to a route than a dialog, so it stops claiming to
       * be modal. Escape and the close button still close it — see
       * `onInteractOutside` below for the third route that used to.
       *
       * The cost, stated plainly: no focus trap. For a view whose surrounding
       * chrome is legitimately interactive that is the correct behaviour, and
       * it hands the header back to screen readers, which modality had removed.
       */
      modal={false}
      onOpenChange={(open) => {
        if (!open) closeSettings();
      }}
    >
      <DialogPrimitive.Content
        aria-describedby={undefined}
        /**
         * An Escape a nested control has claimed is not this dialog's (103).
         *
         * Radix listens for Escape on the **document, in the capture phase**,
         * so it decides before the keystroke reaches whatever is focused — a
         * `stopPropagation` inside the rename editor can never win that race,
         * and the whole overlay closed when the user only meant to abandon an
         * edit. Anything that owns Escape for itself marks its subtree with
         * `data-escape-scope`, and this declines those.
         *
         * A data attribute rather than shared state: the overlay does not need
         * to know *which* control is open, only that one has claimed the key,
         * and a future section gets the behaviour by opting in rather than by
         * wiring something through here.
         */
        onEscapeKeyDown={(event) => {
          if (escapeIsClaimed(event.target)) event.preventDefault();
        }}
        /**
         * A click on the header is a click on the header, not a dismissal.
         *
         * Without this, `modal={false}` would restore the pointer but Radix
         * would still treat the same click as an outside-interaction and close
         * the overlay — so the theme would toggle *and* settings would vanish,
         * which is half the reported bug still standing. Settings is left by
         * its close button or Escape.
         */
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        className="@container flex min-h-0 flex-1 flex-col bg-panel-2 outline-none"
      >
        {/* The Overmind head's own title and padding, so a place and Settings read at the same weight. */}
        <div className="flex items-center justify-between border-b border-border-soft px-4 pt-4 pb-3 @xl:px-7">
          <DialogPrimitive.Title className="text-[18px] font-semibold text-ink">
            Settings
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Close settings"
            className="rounded-full p-1.5 text-subtle hover:bg-hover hover:text-ink"
          >
            <X size={13} weight="bold" />
          </DialogPrimitive.Close>
        </div>

        {/*
          Two columns from `@xl` of the overlay's own width (36rem), not the
          window's: the overlay is the centre stage, and the rails decide how
          much of the window that is. Below it one half shows at a time, chosen
          by `paneOpen`; `data-view` says which, for the tests that cannot lay out.
        */}
        <div
          data-testid="settings-body"
          data-view={paneOpen ? 'pane' : 'list'}
          className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] @xl:grid-cols-[148px_1fr]"
        >
          <nav
            ref={navRef}
            aria-label="Settings sections"
            className={cn(
              'flex min-h-0 flex-col gap-3.5 overflow-y-auto p-3 @xl:border-r @xl:border-border-soft',
              paneOpen && '@max-xl:hidden',
            )}
          >
            {GROUPS.map((entry) => {
              const labelId = `${groupId}-${entry.group}`;

              return (
                <div
                  key={entry.group}
                  role="group"
                  aria-labelledby={labelId}
                  className="flex flex-col gap-0.5"
                >
                  <span
                    id={labelId}
                    className="px-2.5 pb-1 text-ui-sm font-semibold tracking-[0.06em] text-muted uppercase"
                  >
                    {entry.group}
                  </span>
                  {entry.panes.map((pane) => {
                    const active = pane.id === section;

                    return (
                      <button
                        key={pane.id}
                        type="button"
                        data-pane={pane.id}
                        tabIndex={active ? 0 : -1}
                        // `page` rather than `true`: this nav selects which page of
                        // settings is showing, which is what the token means.
                        aria-current={active ? 'page' : undefined}
                        onKeyDown={onNavKeyDown}
                        onClick={() => openPane(pane.id)}
                        className={cn(
                          'flex items-center justify-between rounded-md px-2.5 py-1 text-left text-ui outline-none',
                          'focus-visible:ring-1 focus-visible:ring-brand',
                          // A touch-sized row when it is the whole list.
                          '@max-xl:min-h-11',
                          active
                            ? 'bg-active text-ink'
                            : 'text-muted hover:bg-hover hover:text-ink',
                        )}
                      >
                        {pane.label}
                        <CaretRight size={12} aria-hidden className="text-subtle @xl:hidden" />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <div className={cn('flex min-h-0 min-w-0 flex-col', !paneOpen && '@max-xl:hidden')}>
            <button
              ref={backRef}
              type="button"
              aria-label={`Back to ${groupOf(section)}`}
              onClick={backToList}
              className="flex min-h-11 items-center gap-1 self-start px-4 text-control text-muted outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-brand @xl:hidden"
            >
              <CaretLeft size={12} aria-hidden />
              {groupOf(section)}
            </button>
            <Pane />
          </div>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}
