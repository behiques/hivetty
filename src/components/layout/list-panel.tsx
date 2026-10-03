import { useEffect, useRef, type ComponentType } from 'react';

import { cn } from '@/lib/utils';

import { AgentsPanel } from '@features/agents/components/agents-panel';
import { SessionsPanel } from '@features/projects/components/sessions-panel';
import { PrsPanel } from '@features/pull-requests/components/prs-panel';
import { WorkList } from '@features/work/components/work-panel';
import {
  useAgentsListed,
  usePrsListed,
  usePrsQuiet,
  useSessionsListed,
  useWorkListed,
} from '@stores/hive-store';
import { usePanelOpen, usePlace, usePrSearchOpen, type Place } from '@stores/ui-store';

/**
 * Each place's panel (HIVE-195). Home has none. Sessions has its own since
 * HIVE-197, Work its grouped rows since HIVE-203, Agents since HIVE-204, and
 * PRs is the Hatchery since HIVE-205. PRs also still shows in the ActivityRail
 * until HIVE-201 retires it — accepted while round two is opt-in.
 */
const PANELS: Record<Place, ComponentType | null> = {
  home: null,
  sessions: SessionsPanel,
  work: WorkList,
  agents: AgentsPanel,
  prs: PrsPanel,
};

const LABELS: Record<Place, string> = {
  home: 'Home',
  sessions: 'Sessions',
  work: 'Work',
  agents: 'Agents',
  prs: 'PRs',
};

/**
 * Round two's one list panel: fixed at `--cc-list-w`, beside the stage, never
 * instead of it. Not resizable and no collapsed strip — HIVE-105's handles and
 * strip stay Classic's; closing is `panelOpen`.
 *
 * No list without items (HIVE-211): a place with nothing to list draws no
 * panel, and its stage says why — Jira not connected, gh signed out, no agent,
 * no project. Loading keeps the panel, for its skeleton.
 */
export function ListPanel() {
  const place = usePlace();
  const panelOpen = usePanelOpen();
  const Panel = PANELS[place];
  const prsQuiet = usePrsQuiet();
  const searchOpen = usePrSearchOpen();
  /* Every hook runs on every render, so all four are read rather than one indexed by place. */
  const listed: Record<Place, boolean> = {
    home: false,
    sessions: useSessionsListed(),
    work: useWorkListed(),
    agents: useAgentsListed(),
    prs: usePrsListed(),
  };

  /* Was the Hatchery quiet on the last render? Only that change slides the panel in (R4), never a mount. */
  const wasQuiet = useRef(prsQuiet);
  const arriving = place === 'prs' && wasQuiet.current && !prsQuiet;
  useEffect(() => {
    wasQuiet.current = prsQuiet;
  });

  if (!Panel || !panelOpen) return null;
  /* A quiet or unconfigured Hatchery's search still opens it (D15); the stage has the egg otherwise. */
  if (!listed[place] && !(place === 'prs' && searchOpen)) return null;

  return (
    <section
      aria-label={`${LABELS[place]} list`}
      className={cn(
        'flex w-[var(--cc-list-w)] shrink-0 flex-col border-r border-border-soft bg-panel px-2.5 pt-3.5 pb-5',
        arriving && 'motion-safe:animate-ccslidein',
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Panel />
      </div>
    </section>
  );
}
