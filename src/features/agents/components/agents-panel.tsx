import { CaretRight, Clock, Plus } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef } from 'react';

import { agentGroups } from '@/lib/swarms';
import { cn } from '@/lib/utils';

import { EmptyState } from '@components/ui/empty-state';
import { AgentRow } from '@features/agents/components/agent-row';
import { useSwarms } from '@hooks/use-swarms';
import { useAgentsByGroup, useStallCount } from '@stores/hive-store';
import {
  type AgentGroupKey,
  useAgentPageActions,
  useAgentsFocus,
  useAgentsFolded,
  useClearAgentsFocus,
  useShowStalls,
  useStallsShown,
  useToggleAgentGroup,
} from '@stores/ui-store';

/** The fold key of the Summons lane; every other section folds under its swarm group id. */
const SUMMONS = 'summons';

interface LaneProps {
  foldKey: string;
  title: string;
  /** The header after the title: Summons' count, or a section's morphing count and total. */
  counts: ReactNode;
  /** Summons' amber square; swarm sections have none and are told apart by name. */
  square?: boolean;
  children: ReactNode;
}

/** One folding lane: a caret header and its rows, folded under `foldKey` in the ui-store. */
function Lane({ foldKey, title, counts, square = false, children }: LaneProps) {
  const folded = useAgentsFolded()[foldKey] === true;
  const toggle = useToggleAgentGroup();

  return (
    <section data-group={foldKey} aria-label={title} className="mb-2.5 flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={!folded}
        onClick={() => toggle(foldKey)}
        className="flex items-center gap-2 px-1.5 pt-2.5 pb-1.5 text-ui-sm font-semibold tracking-[0.06em] text-subtle uppercase"
      >
        <CaretRight size={12} aria-hidden="true" className={folded ? '' : 'rotate-90'} />
        {square ? <span aria-hidden="true" className="size-[9px] rounded-xs bg-amber" /> : null}
        {title}
        {counts}
      </button>

      {folded ? null : children}
    </section>
  );
}

/**
 * Agents panel — the long-lived background agents, grouped by what they are
 * doing.
 *
 * ## The list comes from disk
 *
 * This panel used to list three seeded agents — a Slack watcher, a PR reviewer,
 * a standup writer — which were a sketch of a feature rather than a feature.
 * Nothing started them, nothing could stop them, and their transcripts were
 * recordings. They went with the rest of the seed, leaving the list genuinely
 * empty and the copy pointing at nothing.
 *
 * Since HIVE-114 there is somewhere to point: `useAgentsSync` mirrors
 * `~/.hivetty/agents` into the store, so a row here is a real `AGENT.md`.
 *
 * ## Why grouped, and why by state
 *
 * A flat alphabetical list answers "what do I have"; a panel is read to answer
 * "what needs me". Grouping by state puts the second question first — and it
 * is the state, not the name, that changes minute to minute (HIVE-116). Since
 * HIVE-204 the groups are lanes, each folding under its own header.
 *
 * ## Grouped by swarm under a Summons lane (HIVE-454)
 *
 * Summons (asking, failed, invalid) comes first, from every swarm, each row
 * tagged with its swarm. Below it, one folding section per swarm in
 * `agentGroups` order (Settings order, My swarm last), working agents first and
 * then resting ones. A section header counts its working agents in green and
 * its rows in total. The header's summons and morphing counts are unchanged.
 * `openAgentsAt(groupId)` sets a focus, which the panel scrolls into view and
 * clears.
 *
 * The ordering rules — asking first, `failed` and invalid filed under Summons,
 * paused after sleeping, empty groups omitted — live in `useAgentsByGroup` and
 * `agentGroups`, so this component renders a decision rather than making one.
 */
export function AgentsPanel() {
  const groups = useAgentsByGroup();
  const { listing } = useSwarms();
  const focus = useAgentsFocus();
  const clearFocus = useClearAgentsFocus();
  const panel = useRef<HTMLDivElement>(null);
  const { openAgentPage } = useAgentPageActions();
  const stallsShown = useStallsShown();
  const showStalls = useShowStalls();
  const stalls = useStallCount();

  const idsOf = (key: AgentGroupKey) => groups.find((group) => group.key === key)?.ids ?? [];
  const summonsIds = idsOf('summons');
  const morphingIds = idsOf('morphing');
  const summons = summonsIds.length;
  const morphing = morphingIds.length;
  const working = new Set(morphingIds);
  const sections = agentGroups(listing, [...morphingIds, ...idsOf('burrowed')]);

  // A swarm whose agents are all asking or failed has no section, only rows in Summons.
  const inSummons = focus !== null && agentGroups(listing, summonsIds).some((group) => group.id === focus);
  const summonsFolded = useAgentsFolded()[SUMMONS] === true;
  const toggle = useToggleAgentGroup();

  // The comb's "+N" for a swarm (HIVE-454): scroll its section into view, once, then let the focus go.
  // With no section, its agents are in Summons: unfold that and scroll there instead.
  useEffect(() => {
    if (focus === null) return;

    const at = (key: string) => panel.current?.querySelector(`section[data-group="${CSS.escape(key)}"]`);
    let section = at(focus);

    if (!section && inSummons) {
      if (summonsFolded) toggle(SUMMONS);
      section = at(SUMMONS);
    }
    if (section && typeof section.scrollIntoView === 'function') section.scrollIntoView({ block: 'start' });
    clearFocus();
  }, [focus, clearFocus, inSummons, summonsFolded, toggle]);
  /*
    The way to make another agent: a new agent's page, on Definition
    (HIVE-204). The page owns authoring now, so the panel opens it here
    rather than sending the user to Settings and back. The head's + is the
    only entry; a footer line beside it was the same act twice.
  */
  const newAgent = () => openAgentPage(null, 'definition');

  return (
    <div ref={panel} data-panel="agents" className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2.5 px-2 pt-2.5 pb-2 text-muted">
        <h2 className="text-ui-lg font-semibold text-ink">Agents</h2>
        <span className="text-ui-sm">
          {summons > 0 ? (
            <span className="text-amber-text">{`${String(summons)} summons`}</span>
          ) : null}
          {summons > 0 && morphing > 0 ? ' · ' : null}
          {morphing > 0 ? (
            <span className="text-green">{`${String(morphing)} morphing`}</span>
          ) : null}
        </span>
        <button
          type="button"
          aria-label="New agent"
          onClick={newAgent}
          className="ml-auto self-center rounded-full p-1.5 text-muted hover:bg-hover hover:text-ink"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      {/* What every ask, wake and card is waiting on (HIVE-411): the stall panel, shown on the stage. */}
      <button
        type="button"
        aria-pressed={stallsShown}
        onClick={showStalls}
        className={cn(
          'mb-1.5 flex items-center justify-between rounded-md px-2.5 py-[var(--cc-row-py)] text-ui',
          stallsShown ? 'bg-active text-ink' : 'text-muted hover:bg-hover',
        )}
      >
        <span className="flex items-center gap-2">
          <Clock aria-hidden="true" className="size-3.5 text-amber-text" />
          <span className="font-medium">Stalls</span>
        </span>
        {stalls === 0 ? null : (
          <span className="rounded-full bg-amber px-1.5 text-micro font-semibold text-on-brand">{stalls}</span>
        )}
      </button>

      {groups.length === 0 ? (
        <EmptyState phrase="empty.agents" creature="mutalisk">
          No agents yet.
        </EmptyState>
      ) : (
        <>
          {summons === 0 ? null : (
            <Lane
              foldKey={SUMMONS}
              title="Summons"
              square
              counts={<span className="font-medium text-subtle">{summons}</span>}
            >
              {summonsIds.map((id) => (
                <AgentRow key={id} id={id} showSwarm />
              ))}
            </Lane>
          )}
          {sections.map((section) => {
            const busy = section.names.filter((name) => working.has(name)).length;

            return (
              <Lane
                key={section.id}
                foldKey={section.id}
                title={section.title}
                counts={
                  <span className="font-medium text-subtle">
                    {busy > 0 ? (
                      <>
                        <span className="text-green">{busy}</span>
                        {' · '}
                      </>
                    ) : null}
                    {section.names.length}
                  </span>
                }
              >
                {section.names.map((id) => (
                  <AgentRow key={id} id={id} />
                ))}
              </Lane>
            );
          })}
        </>
      )}

    </div>
  );
}
