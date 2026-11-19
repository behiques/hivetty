import { Robot } from '@phosphor-icons/react';

import { StripHead, StripRow } from '@features/home/components/strip-row';
import { SwarmStarters } from '@features/shared/components/swarm-starters';
import { useAgents } from '@hooks/use-agents';
import { useComingUp } from '@stores/hive-store';

const pad = (n: number) => String(n).padStart(2, '0');

/** `16:00`, local, 24-hour, as the mock draws it. */
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Home's Coming up (HIVE-200): scheduled wakes soonest first, then held pickups. Not drawn when empty, unless no
 * agent is installed at all (HIVE-447): then it says agents come in swarms and offers the starters. That waits for
 * the definitions to have been read (`null` until then), so a home with agents never flashes the line at launch.
 */
export function ComingUp() {
  const rows = useComingUp();
  const agents = useAgents();
  if (rows.length === 0) {
    if (agents?.agents.length !== 0) return null;
    return (
      <section aria-label="Agents" className="grid min-w-0 content-start gap-px">
        <StripHead>Agents</StripHead>
        <p className="text-ui text-muted">No agents yet. Agents come in swarms.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <SwarmStarters size="sm" />
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Coming up" className="grid min-w-0 content-start gap-px">
      <StripHead>Coming up</StripHead>
      {rows.map((row) => (
        <StripRow
          key={row.id}
          icon={<Robot size={15} className="text-subtle" aria-hidden="true" />}
          name={row.agent}
          detail={row.what}
          value={row.at === undefined ? undefined : hhmm(row.at)}
        />
      ))}
    </section>
  );
}
