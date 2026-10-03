import { useEffect, useState } from 'react';

import { isAgent } from '@/types/entity';

import { Icon } from '@components/ui/icon';
import { SegmentedControl } from '@components/ui/segmented-control';
import { AgentDefinition } from '@features/agents/components/agent-definition';
import { runRefusal } from '@features/agents/components/agent-editor';
import { AgentView } from '@features/agents/components/agent-view';
import { useAgents } from '@hooks/use-agents';
import { useAgentDraft } from '@stores/editor-store';
import { agentRunQueued, agentRunRefusal, useEntity } from '@stores/hive-store';
import { useAgentPage, useAgentPageActions, type AgentPageView } from '@stores/ui-store';

const VIEWS = [
  { value: 'activity', label: 'Activity' },
  { value: 'definition', label: 'Definition' },
] as const satisfies readonly { value: AgentPageView; label: string }[];

/**
 * One agent's page on the stage (HIVE-204): a header, then Activity or
 * Definition.
 *
 * The header is the agent's identity — its glyph, its name over its
 * description — then the Activity | Definition switch and Run now. Pause stays
 * here until the lanes panel's row takes it, so it is never unreachable. There
 * is no back button: the page belongs to the Agents place, and the bar is the
 * way to another place. Edit definition is gone too, because Definition is one
 * click away on the switch.
 *
 * Run now is in the header so it is in both views, and it stays **enabled**:
 * a refusal is answered with the sentence, under the header on Activity and in
 * the footer on Definition, which is where the run notice has always shown.
 */
export function AgentPage({ name }: { name: string | null }) {
  const page = useAgentPage();
  const { setAgentPageView } = useAgentPageActions();
  const entity = useEntity(name ?? '');
  const agent = entity !== undefined && isAgent(entity) ? entity : undefined;
  const snapshot = useAgents();
  const draft = useAgentDraft(name ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  // A notice about one agent must not be read as being about the next.
  useEffect(() => setNotice(null), [name]);

  const view: AgentPageView = name === null ? 'definition' : (page?.view ?? 'activity');
  /*
    The path `runRefusal` asks about: there is a file on disk exactly when the
    agent has a name. The folder root is only for the sentence's sake — the
    refusal reads whether it is null.
  */
  const path = name === null ? null : `${snapshot?.agentsRoot ?? ''}/${name}/AGENT.md`;
  const refusal = runRefusal(path, draft?.dirty ?? false);

  const runNow = () => {
    if (refusal !== null || name === null) {
      setNotice(refusal);
      return;
    }
    setNotice(null);

    /*
      The wording comes from `agentRunRefusal` and `agentRunQueued`, not from a
      ternary here (HIVE-117): the shared functions switch exhaustively over
      the union, so the next refusal is a compile error rather than a plausible
      sentence. A definition main refused comes back as the runtime's own
      `invalid`, so the header does not need to know the problems.
    */
    void window.hive?.agents
      .run({ name })
      .then((result) => {
        if (result.started) return;
        setNotice('queued' in result ? agentRunQueued(name, result) : agentRunRefusal(name, result));
      })
      .catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : String(cause)));
  };

  /**
   * Stop this agent waking, and let it wake again (HIVE-117).
   *
   * One control rather than two, because the states are exclusive and the
   * button's job is to name what pressing it does. Both channels **reject**
   * when the runtime is not up — answering a status they never wrote is what
   * their contract calls the one outcome worth a rejected promise — so both
   * need the catch.
   */
  const togglePause = () => {
    if (agent === undefined) return;
    setNotice(null);

    const bridge = window.hive?.agents;

    if (bridge === undefined) return;

    void (agent.status === 'paused' ? bridge.resume({ name: agent.id }) : bridge.pause({ name: agent.id })).catch(
      (cause: unknown) => setNotice(cause instanceof Error ? cause.message : String(cause)),
    );
  };

  return (
    <div className="@container flex min-h-0 flex-1 flex-col" data-view="agent">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-soft bg-panel px-5 py-3">
        <Icon name={agent?.icon ?? 'ph-robot'} size={20} className="shrink-0 text-subtle" />
        <span className="flex max-w-[420px] min-w-0 flex-col">
          <span className="truncate font-mono text-[13px] font-semibold">{name ?? 'New agent'}</span>
          <span className="truncate font-sans text-[11.5px] text-muted">{agent?.sub ?? 'not saved yet'}</span>
        </span>
        <span className="flex-1" />
        <SegmentedControl
          label="View"
          options={VIEWS}
          value={view}
          onChange={setAgentPageView}
          disabledValues={name === null ? ['activity'] : undefined}
        />
        {/*
          Native `title`, as the editor's footer button had it: it previews the
          refusal a click would give, and the click still answers with it.
        */}
        <button
          type="button"
          onClick={runNow}
          title={refusal ?? 'Wake this agent once, now.'}
          className="rounded-md border border-border px-2.5 py-1 text-[12px] text-ink hover:bg-hover"
        >
          Run now
        </button>
        {agent === undefined ? null : (
          <button
            type="button"
            onClick={togglePause}
            title={
              agent.status === 'paused'
                ? 'Let this agent wake again'
                : 'Stop this agent waking. A turn already running finishes.'
            }
            className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-ink"
          >
            {agent.status === 'paused' ? '▶ Resume' : '⏸ Pause'}
          </button>
        )}
      </header>
      {view === 'activity' && agent !== undefined ? (
        <AgentView entity={agent} notice={notice} onNotice={setNotice} />
      ) : (
        <AgentDefinition name={name} notice={notice} />
      )}
    </div>
  );
}
