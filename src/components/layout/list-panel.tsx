import type { ComponentType } from 'react';

import { AgentsPanel } from '@features/agents/components/agents-panel';
import { SessionsPanel } from '@features/projects/components/sessions-panel';
import { PrsPanel } from '@features/pull-requests/components/prs-panel';
import { WorkList } from '@features/work/components/work-panel';
import { usePanelOpen, usePlace, type Place } from '@stores/ui-store';

/**
 * Each place's panel (HIVE-195). Home has none. Sessions has its own since
 * HIVE-197 and Work its grouped rows since HIVE-203; the rest are still
 * `left-rail.tsx`'s and are replaced in their own stories (HIVE-204, 205). PRs
 * also still shows in the ActivityRail until HIVE-201 retires it — accepted
 * while round two is opt-in.
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
 */
export function ListPanel() {
  const place = usePlace();
  const panelOpen = usePanelOpen();
  const Panel = PANELS[place];

  if (!Panel || !panelOpen) return null;

  return (
    <section
      aria-label={`${LABELS[place]} list`}
      className="flex w-[var(--cc-list-w)] shrink-0 flex-col border-r border-border-soft bg-panel px-2.5 pt-3.5 pb-5"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Panel />
      </div>
    </section>
  );
}
