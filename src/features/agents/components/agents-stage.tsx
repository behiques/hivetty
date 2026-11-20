import { Robot } from '@phosphor-icons/react';

import { Button } from '@components/ui/button';
import { CombGlyph } from '@components/ui/comb-glyph';
import { EmptyPlace } from '@components/ui/empty-place';
import { AgentPage } from '@features/agents/components/agent-page';
import { StallPanel } from '@features/agents/components/stall-panel';
import { useShownAgent } from '@features/agents/shown-agent';
import { SwarmStarters } from '@features/shared/components/swarm-starters';
import { useAgentsListed } from '@stores/hive-store';
import { useAgentPageActions, useStallsShown } from '@stores/ui-store';

/**
 * The Agents place's stage (HIVE-204): the shown agent's page (`useShownAgent`:
 * the last one, else the next, else the first), or "Pick an agent" when none is — Work's empty shape, for the same reason: the place
 * owns the stage either way, and an empty stage that says what to do beats
 * the Overmind showing through. With no agent defined it says agents come in
 * swarms and offers Install Dev Squad, Browse swarms and New agent (HIVE-211, HIVE-447).
 *
 * Keyed by the agent, so moving to another one remounts the page: its notice,
 * and the editor's per-field state, belong to the agent they were about.
 */
export function AgentsStage() {
  const name = useShownAgent();
  const listed = useAgentsListed();
  const { openAgentPage } = useAgentPageActions();
  const stallsShown = useStallsShown();

  // The Stalls row is selected (HIVE-411): the stall panel, with or without agents.
  if (stallsShown) return <StallPanel />;

  if (name === undefined) {
    if (!listed) {
      return (
        <EmptyPlace
          label="Agents"
          glyph={<CombGlyph icon={Robot} />}
          title="No agents yet"
          actions={
            <>
              <SwarmStarters />
              <Button variant="ghost" onClick={() => openAgentPage(null, 'definition')}>
                New agent
              </Button>
            </>
          }
        >
          Agents come in swarms. Install Dev Squad for the ticket-to-merge workflow, or browse for others.
        </EmptyPlace>
      );
    }
    return (
      <section aria-label="Agents" className="flex flex-1 items-center justify-center">
        <p className="text-ui text-subtle">Pick an agent</p>
      </section>
    );
  }

  return <AgentPage key={name ?? 'new'} name={name} />;
}
