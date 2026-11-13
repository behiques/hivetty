import type { ReactNode } from 'react';

import { cn } from '@lib/utils';
import { useAgentRefusals, usePermissionCardList, useStaleClaims, useStalls, type StallAsk } from '@stores/hive-store';

/** `41m`, `1h 52m`, `3d`: the panel's one age format (HIVE-411). */
export function age(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${String(m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ${String(m % 60)}m`;
  return `${String(Math.floor(h / 24))}d`;
}

const STATE_TONE: Record<StallAsk['state'], string> = {
  open: 'text-muted',
  delivered: 'text-amber-text',
  accepted: 'text-green',
};

function Group({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <section aria-label={label} className="rounded-lg border border-border bg-panel">
      <h3 className="border-b border-border-soft px-3.5 py-2.5 text-ui-sm font-semibold uppercase tracking-[0.06em] text-subtle">
        {`${label} · ${String(count)}`}
      </h3>
      {count === 0 ? <p className="px-3.5 py-2.5 text-ui-sm text-subtle">None</p> : children}
    </section>
  );
}

/** One row of a side group: a name and its age, then up to two lines under it. */
function Item({ name, ageText, ageTone, lines }: { name: string; ageText: string; ageTone: string; lines: ReactNode[] }) {
  return (
    <li>
      <div className="flex justify-between gap-2">
        <span className="truncate font-medium text-ink">{name}</span>
        <span className={cn('shrink-0 text-ui-sm tabular-nums', ageTone)}>{ageText}</span>
      </div>
      {lines}
    </li>
  );
}

/** The Agents stage's stall panel (HIVE-411): what every owed ask, refused wake, card and stale claim is waiting on. Reads only. */
export function StallPanel() {
  const asks = useStalls();
  const refusals = useAgentRefusals();
  const cards = usePermissionCardList(null);
  const claims = useStaleClaims();
  const now = Date.now();

  return (
    <section aria-label="Stalls" className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-7 py-6">
      <header>
        <h2 className="text-ui-lg font-semibold text-ink">Stalls</h2>
        <p className="text-ui-sm text-subtle">
          What every open ask, wake and card is waiting on. Read from the ledger; nothing here acts.
        </p>
      </header>

      <Group label="Open asks" count={asks.length}>
        <div className="overflow-x-auto">
          <table className="w-full text-ui tabular-nums">
            <thead>
              <tr className="text-left text-ui-sm text-term-head">
                <th className="px-3.5 py-1.5 font-medium">Ask</th>
                <th className="px-2 py-1.5 font-medium">From → owes</th>
                <th className="px-2 py-1.5 font-medium">State</th>
                <th className="px-2 py-1.5 text-right font-medium">In state</th>
                <th className="px-2 py-1.5 text-right font-medium">To accept</th>
                <th className="px-3.5 py-1.5 text-right font-medium">Open for</th>
              </tr>
            </thead>
            <tbody>
              {asks.map((ask) => (
                <tr key={ask.id} className="border-t border-border-soft">
                  <td className="px-3.5 py-2">
                    <span className="font-medium text-ink">{ask.ref}</span>{' '}
                    <span className="text-muted">{ask.body}</span>
                  </td>
                  <td className="px-2 py-2 text-ink">{`${ask.from} → ${ask.owes}`}</td>
                  <td className="px-2 py-2">
                    <span className={cn('rounded-full bg-chip px-2 py-px text-micro', STATE_TONE[ask.state])}>{ask.state}</span>
                  </td>
                  <td className="px-2 py-2 text-right">{age(ask.inStateMs)}</td>
                  <td className="px-2 py-2 text-right">{ask.toAcceptMs === null ? '—' : age(ask.toAcceptMs)}</td>
                  <td className="px-3.5 py-2 text-right">{age(ask.openMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Group>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Group label="Refused wakes" count={refusals.length}>
          <ul className="flex flex-col gap-2 px-3.5 py-2.5">
            {refusals.map(({ agent, refusal }) => (
              <Item
                key={`${agent} ${refusal.lane}`}
                name={agent}
                ageText={age(now - refusal.at)}
                ageTone="text-subtle"
                lines={[
                  <div key="reason" className="text-ui-sm text-red">{refusal.reason}</div>,
                  <div key="lane" className="text-ui-sm text-subtle">{`${refusal.lane} lane · ${String(refusal.queued)} queued`}</div>,
                ]}
              />
            ))}
          </ul>
        </Group>

        <Group label="Permission cards" count={cards.length}>
          <ul className="flex flex-col gap-2 px-3.5 py-2.5">
            {cards.map((card) => (
              <Item
                key={card.id}
                name={card.subject ?? 'unknown asker'}
                ageText={age(now - card.createdAt)}
                ageTone="text-amber-text"
                lines={[<div key="title" className="truncate text-ui-sm text-subtle">{card.title}</div>]}
              />
            ))}
          </ul>
        </Group>

        <Group label="Stale claims" count={claims.length}>
          <ul className="flex flex-col gap-2 px-3.5 py-2.5">
            {claims.map((claim) => (
              <Item
                key={claim.task}
                name={claim.task}
                ageText={age(now - claim.since)}
                ageTone="text-subtle"
                lines={[
                  <div key="holder" className="text-ui-sm text-subtle">{`${claim.holder} · no live lane, nothing owed`}</div>,
                ]}
              />
            ))}
          </ul>
        </Group>
      </div>
    </section>
  );
}
