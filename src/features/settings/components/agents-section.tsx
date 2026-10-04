import { useEffect } from 'react';

import { useSwarmPhrase } from '@/hooks/use-swarm-phrase';
import { loadAgents } from '@/lib/agents';
import { loadShipped } from '@/lib/shipped';

import { Icon } from '@components/ui/icon';
import { SwarmCreature } from '@components/ui/swarm-creature';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { ShippedDot } from '@features/shared/components/shipped-marker';
import { useAgents } from '@hooks/use-agents';
import { useShipped } from '@hooks/use-shipped';
import { useAgentPageActions } from '@stores/ui-store';

/**
 * The Agents section of settings (HIVE-114): the list, and New agent.
 *
 * The editor this section used to hold beside the list moved to the agent's
 * own page (HIVE-204). A row opens that page on Definition and New agent opens
 * a never-saved one — both through ui-store, so Settings imports nothing from
 * the agents slice. The list keeps what it always said about each agent: its
 * glyph, its name, the shipped dot and its state.
 *
 * A broken definition's row is not disabled — unlike an invalid skill's. The
 * folder names it, so there is always a file to open, and the user has to be
 * able to open it to fix the key they were told about.
 */
export function AgentsSection() {
  const snapshot = useAgents();
  const phrase = useSwarmPhrase('empty.settingsSkills');

  const { openAgentPage } = useAgentPageActions();

  useEffect(() => {
    void loadAgents();
  }, []);

  /*
    What the user changed in the agents the app ships. Asked again whenever the
    snapshot changes, which is every save and every edit made outside the app,
    so the dot follows the file rather than the last launch.
  */
  const shipped = useShipped('agents');
  useEffect(() => {
    void loadShipped();
  }, [snapshot]);

  const agents = snapshot?.agents ?? [];
  const empty = agents.length === 0;

  const newAgent = (): void => openAgentPage(null, 'definition');

  const description =
    'Background agents that wake on a schedule or a message and correspond through the ledger. Saved as AGENT.md under ~/.hive/agents.';

  /*
    No snapshot is the browser demo, which has no bridge to ask and no disk to
    write to — the same header-only shape `skills-section.tsx` uses, and for
    the same reason: a pane of dead controls teaches the user the app is broken.
  */
  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader
          title="Agents"
          description="Background agents are only available in the desktop app."
        />
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader title="Agents" description={description} />

        <div className="flex flex-col items-center gap-1 rounded-[7px] border border-dashed border-border px-4 py-6 text-center">
          <SwarmCreature creature="mutalisk" size={72} />
          <span className="text-[11.5px] text-muted">{phrase}</span>
          <span className="text-[11.5px] text-subtle">
            Write one and it will be listed here, asleep until the waker lands.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={newAgent}
            className="w-fit rounded-md bg-brand-fill px-3 py-1.5 text-[12.5px] text-on-brand hover:bg-brand-fill-hover"
          >
            + New agent
          </button>

        </div>

        <p className="mt-auto pt-2 text-[11px] text-subtle">
          Agents folder: {snapshot.agentsRoot}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden px-5 py-4">
      <SettingsSectionHeader title="Agents" description={description} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[7px] border border-border">
        {agents.map((agent) => {
          const broken = agent.invalid !== undefined;

          return (
            <button
              key={agent.name}
              type="button"
              onClick={() => openAgentPage(agent.name, 'definition')}
              title={broken ? agent.invalid : undefined}
              /*
                Not `justify-between`. The identity is one group pinned left —
                glyph then name — and the status is what floats to the far edge.
              */
              className="flex items-center gap-2 border-b border-border-soft px-2.5 py-1.5 text-left text-[12.5px] text-muted last:border-b-0 hover:bg-hover hover:text-ink"
            >
              {/*
                The agent's own glyph, from `icon:` in its frontmatter, already
                on `AgentSummary`. It is what makes the list scannable rather
                than read: a fleet of five agents is five shapes before it is
                five names.
              */}
              <Icon name={agent.icon} size={14} className="shrink-0 text-brand" />
              <span className="truncate tabular-nums">{agent.name}</span>
              <ShippedDot status={shipped.get(agent.name)} />
              {broken ? (
                <span className="ml-auto shrink-0 text-[11px] text-amber">invalid</span>
              ) : (
                <span
                  className="ml-auto shrink-0 text-[11px] text-subtle"
                  title={
                    agent.wake.everyMs === undefined && agent.wake.on.length === 0
                      ? 'Manual only — no schedule and no triggers.'
                      : undefined
                  }
                >
                  {agent.status}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={newAgent}
          className="border-t border-border-soft px-2.5 py-1.5 text-left tabular-nums text-[12.5px] text-brand hover:bg-hover"
        >
          + New agent
        </button>
      </div>

      <p className="text-[11px] text-subtle">
        Agents folder: {snapshot.agentsRoot}
      </p>
    </div>
  );
}
