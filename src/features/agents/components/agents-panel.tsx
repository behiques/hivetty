import { Fragment } from 'react';

import { EmptyState } from '@components/ui/empty-state';
import { AgentRow } from '@features/agents/components/agent-row';
import { useAgentsByGroup } from '@stores/hive-store';
import { useAgentPageActions } from '@stores/ui-store';

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
 * `~/.hive/agents` into the store, so a row here is a real `AGENT.md`.
 *
 * ## Why grouped, and why by state
 *
 * A flat alphabetical list answers "what do I have"; a rail is read to answer
 * "what needs me". Grouping by state puts the second question first — and it
 * is the state, not the name, that changes minute to minute (HIVE-116). The
 * headers use the same uppercase-subtle style as the fleet table's
 * ACTIVE/ENDED, with a count, because they are the same kind of thing.
 *
 * The ordering rules — asking first, `failed` filed under Awake, empty groups
 * omitted — all live in `useAgentsByGroup`, so this component renders a
 * decision rather than making one.
 */
export function AgentsPanel() {
  const groups = useAgentsByGroup();
  const { openAgentPage } = useAgentPageActions();

  const newAgentButton = (
    <button
      type="button"
      onClick={() => openAgentPage(null, 'definition')}
      className="mt-1 rounded-lg px-2.5 py-[var(--cc-row-py)] text-left text-[12px] text-brand hover:bg-hover"
    >
      + New agent…
    </button>
  );

  if (groups.length === 0) {
    return (
      <div data-panel="agents" className="flex flex-col gap-0.5">
        <EmptyState phrase="empty.agents" creature="hydralisk">
          No agents yet.
        </EmptyState>
        {newAgentButton}
      </div>
    );
  }

  return (
    <div data-panel="agents" className="flex flex-col gap-0.5">
      {groups.map((group) => (
        <Fragment key={group.key}>
          <div className="flex items-center justify-between px-2.5 pt-2 pb-1 text-[10px] tracking-[0.12em] text-subtle uppercase">
            <span>{group.label}</span>
            <span>{group.ids.length}</span>
          </div>

          {group.ids.map((id) => (
            <AgentRow key={id} id={id} />
          ))}
        </Fragment>
      ))}

      {/*
        The way to make another agent: a new agent's page, on Definition
        (HIVE-204). The page owns authoring now, so the panel opens it here
        rather than sending the user to Settings and back.
      */}
      {newAgentButton}
    </div>
  );
}
