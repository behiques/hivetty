import { CaretDown, Check, X } from '@phosphor-icons/react';
import { useState } from 'react';

import type { ArcCounts, LinkedTicket } from '@/lib/ticket-links';
import { cn } from '@/lib/utils';

import { TicketConstellation } from '@features/work/components/ticket-constellation';
import { Section, TicketProblem } from '@features/work/components/ticket-page-parts';
import { CATEGORY_TEXT } from '@features/work/ticket-presentation';
import { useEpicLabel, useLoadTicketDetail, useTicketDetail, useTicketLinks } from '@stores/hive-store';
import { useOpenWorkTicket } from '@stores/ui-store';

type Arc = 'waitsOn' | 'blocks' | 'relates';
const ARC_LABEL: Record<Arc, string> = { waitsOn: 'Waits on', blocks: 'Blocks', relates: 'Relates to' };
const GLYPH: [keyof ArcCounts, string][] = [
  ['done', '✓'],
  ['in-progress', '●'],
  ['todo', '◌'],
];

/**
 * A ticket's links: the verdict, the constellation and a row per non-empty arc
 * that opens its list. The session panel's Ticket tab (HIVE-202) and the Work
 * page's properties column both draw it; `pr` is the one drawn as a satellite.
 */
export function TicketLinks({ ticketKey, pr }: { ticketKey: string; pr: number | null }) {
  const model = useTicketLinks(ticketKey);
  const epic = useEpicLabel(ticketKey);
  const linksProblem = useTicketDetail(ticketKey)?.problems.links;
  const load = useLoadTicketDetail();
  const openOnWork = useOpenWorkTicket();
  const [openArc, setOpenArc] = useState<Arc | null>(null);
  const toggle = (arc: Arc) => setOpenArc((now) => (now === arc ? null : arc));

  if (model === undefined) {
    return linksProblem === undefined ? null : (
      <Section title="Links">
        <TicketProblem message={linksProblem} onRetry={() => void load(ticketKey, 'tab')} />
      </Section>
    );
  }

  return (
    <Section title="Links" count={model.total}>
      {model.total === 0 ? (
        <p className="text-control text-muted">No linked tickets</p>
      ) : (
        <>
          <p
            className={cn(
              'flex items-start gap-2 rounded-md px-2 py-1.5 text-control',
              model.verdict.tone === 'amber' ? 'bg-amber-soft text-amber-text' : 'bg-green-soft text-green',
            )}
          >
            {/* Decoration: the lead beside it says the same thing in words (HIVE-229). */}
            {model.verdict.tone === 'amber' ? (
              <X size={14} weight="bold" aria-hidden="true" data-icon="x" className="mt-[3px] shrink-0" />
            ) : (
              <Check size={14} weight="bold" aria-hidden="true" data-icon="check" className="mt-[3px] shrink-0" />
            )}
            <span>
              <b>{model.verdict.lead}</b>
              <span className="text-muted">{model.verdict.rest}</span>
            </span>
          </p>
          <TicketConstellation
            me={ticketKey}
            arcs={model}
            epicLabel={epic}
            pr={pr}
            onOpenTicket={openOnWork}
            onOpenArc={(arc) => setOpenArc(arc)}
          />
          {(['waitsOn', 'blocks', 'relates'] as const).map((arc) => {
            const tickets: LinkedTicket[] = model[arc];
            if (tickets.length === 0) return null;
            return (
              <div key={arc} className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={openArc === arc}
                  onClick={() => toggle(arc)}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-control text-muted hover:bg-hover"
                >
                  <span>{ARC_LABEL[arc]}</span>
                  <b className="tabular-nums text-ink">{tickets.length}</b>
                  <span className="flex-1" />
                  {GLYPH.filter(([category]) => model.counts[arc][category] > 0).map(([category, glyph]) => (
                    <span key={category} className="inline-flex items-center gap-0.5 tabular-nums text-micro">
                      <span aria-hidden="true">{glyph}</span>
                      {model.counts[arc][category]}
                    </span>
                  ))}
                  <CaretDown size={12} aria-hidden className={cn(openArc === arc && 'rotate-180')} />
                </button>
                {openArc === arc ? (
                  <ul className="flex flex-col">
                    {tickets.map((ticket) => (
                      <li key={ticket.key}>
                        <button
                          type="button"
                          onClick={() => openOnWork(ticket.key)}
                          className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-control hover:bg-hover"
                        >
                          <span className="tabular-nums text-brand">{ticket.key}</span>
                          <span className="min-w-0 flex-1 text-ink">{ticket.summary}</span>
                          <span className={cn('shrink-0', CATEGORY_TEXT[ticket.statusCategory])}>{ticket.status}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </>
      )}
    </Section>
  );
}
