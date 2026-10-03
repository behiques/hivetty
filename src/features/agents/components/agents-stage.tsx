import { AgentPage } from '@features/agents/components/agent-page';
import { useAgentPage } from '@stores/ui-store';

/**
 * The Agents place's stage (HIVE-204): the open agent's page, or "Pick an
 * agent" when none is — Work's empty shape, for the same reason: the place
 * owns the stage either way, and an empty stage that says what to do beats
 * the Overmind showing through.
 *
 * Keyed by the agent, so moving to another one remounts the page: its notice,
 * and the editor's per-field state, belong to the agent they were about.
 */
export function AgentsStage() {
  const page = useAgentPage();

  if (page === null) {
    return (
      <section aria-label="Agents" className="flex flex-1 items-center justify-center">
        <p className="text-[13px] text-subtle">Pick an agent</p>
      </section>
    );
  }

  return <AgentPage key={page.name ?? 'new'} name={page.name} />;
}
