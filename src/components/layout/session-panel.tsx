import { CaretRight, Files, ListChecks, Ticket } from '@phosphor-icons/react';
import { useCallback, type ReactNode } from 'react';

import { useNarrowWindow } from '@/hooks/use-narrow-window';
import { cn } from '@/lib/utils';
import { isSession, isTerminal, terminalOf, type Session, type Terminal } from '@/types/entity';
import type { Ticket as TicketModel } from '@/types/ticket';

import { SessionPanelStrip, type StripTab } from '@components/layout/session-panel-strip';
import { ExplorerPanel } from '@features/explorer/components/explorer-panel';
import { PlanTab } from '@features/plan/components/plan-tab';
import { TicketTab } from '@features/work/components/ticket-tab';
import { resolvePaths } from '@lib/explorer/fs-client';
import type { SessionPlan } from '@shared/plan-contract';
import {
  type SessionPanelTab,
  useEditorLayout,
  useSessionPanelOpen,
  useSessionPanelTab,
  useSetSessionPanelOpen,
  useSetSessionPanelTab,
} from '@stores/appearance-store';
import { useEditorActions } from '@stores/editor-store';
import { useActiveEntity, useChangedFileCount, useOpenTicket, usePlan } from '@stores/hive-store';
import { usePlace, useRevealStage } from '@stores/ui-store';

interface TabContext {
  entity: Session | Terminal;
  /** Main's id for this session: plans and changed files are keyed by it (R2). */
  mainId: string | undefined;
  plan: SessionPlan | undefined;
  changedCount: number;
  /** The session's Jira key, if it works on one (HIVE-202). */
  ticketKey: string | undefined;
  ticket: TicketModel | undefined;
  openPlanFile: (file: string) => void;
}

interface TabSpec {
  id: SessionPanelTab;
  label: (ctx: TabContext) => string;
  exists: (ctx: TabContext) => boolean;
  Icon: StripTab['Icon'];
  fact: (ctx: TabContext) => string;
  count?: (ctx: TabContext) => number;
  body: (ctx: TabContext) => ReactNode;
}

/**
 * The tabs, in order (HIVE-201). HIVE-202 added Ticket; HIVE-209 adds PR
 * between Ticket and Files. Nothing else in the shell changes for them.
 */
const TABS: readonly TabSpec[] = [
  {
    id: 'plan',
    label: () => 'Plan',
    exists: ({ plan }) => plan !== undefined && plan.tasks.length > 0,
    Icon: ListChecks,
    // The strip draws Plan as rings with their own label (SessionPanelStrip), so this fact is the tab's tooltip only.
    fact: ({ plan }) =>
      plan === undefined || plan.allDone
        ? 'Plan, all done'
        : `Plan, ${String(plan.tasks.filter((task) => task.status === 'completed').length)} of ${String(plan.tasks.length)} done`,
    body: ({ plan, openPlanFile }) =>
      plan === undefined ? null : <PlanTab plan={plan} onOpenFile={openPlanFile} />,
  },
  {
    id: 'ticket',
    label: () => 'Ticket',
    exists: ({ ticketKey }) => ticketKey !== undefined,
    Icon: Ticket,
    fact: ({ ticketKey, ticket }) => (ticket ? `${ticket.key} · ${ticket.status}` : (ticketKey ?? 'Ticket')),
    body: ({ entity, ticketKey }) =>
      ticketKey === undefined ? null : <TicketTab ticketKey={ticketKey} sessionId={entity.id} />,
  },
  {
    id: 'files',
    label: ({ changedCount }) => (changedCount === 0 ? 'Files' : `Files ${String(changedCount)}`),
    exists: () => true,
    Icon: Files,
    fact: ({ changedCount }) =>
      changedCount === 0
        ? 'Files'
        : `${String(changedCount)} ${changedCount === 1 ? 'file' : 'files'} changed`,
    count: ({ changedCount }) => changedCount,
    body: ({ mainId }) => <ExplorerPanel {...(mainId === undefined ? {} : { changesId: mainId })} />,
  },
];

/** The tab to show: the persisted one where it exists, else Plan, else Files. */
export function pickTab(existing: readonly SessionPanelTab[], persisted: SessionPanelTab): SessionPanelTab {
  if (existing.includes(persisted)) return persisted;
  return existing.includes('plan') ? 'plan' : 'files';
}

/**
 * Round two's right side (HIVE-201): the session panel, open at 320px with a
 * tab per thing a session has, or closed to a 46px strip of their facts.
 *
 * Drawn while the stage shows a session or terminal (R1), not gated on the
 * view: a file opened full-stage from the Files tab must not make the panel
 * vanish under the click. The Overmind and agents have no such entity.
 */
export function SessionPanel() {
  const entity = useActiveEntity();
  const place = usePlace();
  const owner = entity && (isSession(entity) || isTerminal(entity)) ? entity : null;
  const mainId = owner !== null && isSession(owner) ? terminalOf(owner) : undefined;
  const plan = usePlan(mainId);
  const changedCount = useChangedFileCount(mainId);
  const ticketKey = owner !== null && isSession(owner) ? owner.ticket : undefined;
  const ticket = useOpenTicket(ticketKey ?? null);
  const open = useSessionPanelOpen();
  const tab = useSessionPanelTab();
  const setOpen = useSetSessionPanelOpen();
  const setTab = useSetSessionPanelTab();
  const narrow = useNarrowWindow();
  const { openFile, closeAll } = useEditorActions();
  const { nav } = useEditorLayout();
  const revealStage = useRevealStage();

  /** As terminal file links do (center-stage.tsx): resolve under the session's root, then open. */
  const openPlanFile = useCallback(
    (file: string) => {
      if (owner === null) return;
      const sessionId = isSession(owner) ? owner.id : undefined;
      void resolvePaths(owner.project, sessionId, [file]).then(([target]) => {
        if (target === null || target === undefined) return;
        if (nav === 'single') closeAll();
        openFile(owner.project, target.relPath, sessionId, target.rootKey);
        revealStage();
      });
    },
    [owner, nav, closeAll, openFile, revealStage],
  );

  if (owner === null || place === 'home') return null;

  const ctx: TabContext = { entity: owner, mainId, plan, changedCount, ticketKey, ticket, openPlanFile };
  const existing = TABS.filter((spec) => spec.exists(ctx));
  const shown = pickTab(
    existing.map((spec) => spec.id),
    tab,
  );
  const openTab = (id: SessionPanelTab) => {
    setTab(id);
    setOpen(true);
  };

  if (!open || narrow) {
    return (
      <SessionPanelStrip
        plan={existing.some((spec) => spec.id === 'plan') ? plan : undefined}
        tabs={existing
          .filter((spec) => spec.id !== 'plan')
          .map((spec) => ({
            id: spec.id,
            label: spec.label(ctx),
            Icon: spec.Icon,
            fact: spec.fact(ctx),
            ...(spec.count === undefined ? {} : { count: spec.count(ctx) }),
          }))}
        onOpen={openTab}
      />
    );
  }

  return (
    <aside
      aria-label="Session panel"
      className="flex w-[var(--cc-session-panel-w)] shrink-0 flex-col overflow-hidden border-l border-border bg-panel px-3 py-1.5"
    >
      <div role="tablist" className="flex items-center gap-1 pt-2 pb-2.5 text-[12px] text-muted">
        {existing.map((spec) => (
          <button
            key={spec.id}
            type="button"
            role="tab"
            aria-selected={spec.id === shown}
            onClick={() => {
              setTab(spec.id);
            }}
            className={cn('rounded-md px-2 py-1', spec.id === shown ? 'bg-active text-ink' : 'hover:bg-hover')}
          >
            {spec.label(ctx)}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close the session panel"
          onClick={() => {
            setOpen(false);
          }}
          className="grid size-7 place-items-center rounded-md hover:bg-hover"
        >
          <CaretRight size={14} aria-hidden />
        </button>
      </div>
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {existing.find((spec) => spec.id === shown)?.body(ctx)}
      </div>
    </aside>
  );
}
