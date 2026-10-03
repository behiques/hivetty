import { useCallback, useEffect, useMemo, useRef } from 'react';

import { createPoller } from '@/hooks/create-poller';
import type { Ticket } from '@/types/ticket';

import { SkeletonBar } from '@features/shared/components/skeleton-bar';
import { AdfBlocks } from '@features/work/components/adf-blocks';
import { TicketTransitionMenu } from '@features/work/components/ticket-transition-menu';
import {
  useLoadTicketDetail,
  useOpenTicket,
  useRefreshTicketDetail,
  useReloadTicketTransitions,
  useTicketDetail,
  useTicketRowModels,
} from '@stores/hive-store';
import { useWorkTicket } from '@stores/ui-store';

/** The open ticket's page re-reads once a minute while it is on stage (HIVE-203, D9). */
const usePagePoller = createPoller({ intervalMs: 60_000 });

/** `HH:MM`, the age a section shows beside a failed re-read. */
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * A section's failed read, drawn in that section's place (HIVE-203).
 *
 * With content already on screen the content stays and this says how old it
 * is, so a Jira outage reads as "possibly out of date" rather than as nothing.
 */
export function TicketProblem({
  message,
  onRetry,
  readAt,
}: {
  message: string;
  onRetry: () => void;
  /** When the section last read; omitted when nothing was ever shown. */
  readAt?: number;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-[12px]">
      <span className="text-amber">{message}</span>
      <button type="button" onClick={onRetry} className="text-brand hover:underline">
        Retry
      </button>
      {readAt === undefined ? null : <span className="text-subtle">as of {clock(readAt)}</span>}
    </p>
  );
}

/** Three ragged bars in the shape of the text they stand for. */
export function LinesSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} aria-busy className="flex animate-pulse flex-col gap-2 py-1">
      <SkeletonBar className="w-[92%]" />
      <SkeletonBar className="w-[84%]" />
      <SkeletonBar className="w-[58%]" />
    </div>
  );
}

/** The description, its skeleton until the first read, or its problem in its place. */
function Description({ ticketKey }: { ticketKey: string }) {
  const detail = useTicketDetail();
  const load = useLoadTicketDetail();
  const mine = detail?.key === ticketKey ? detail : null;
  const description = mine?.detail?.description;
  const problem = mine?.problems.detail;
  const retry = () => void load(ticketKey);

  if (description === undefined) {
    return problem === undefined ? (
      <LinesSkeleton label="Loading description" />
    ) : (
      <TicketProblem message={problem} onRetry={retry} />
    );
  }

  return (
    <div className="flex flex-col gap-2 text-[13.5px]">
      {description.length === 0 ? (
        <p className="text-subtle">No description.</p>
      ) : (
        <AdfBlocks blocks={description} />
      )}
      {problem === undefined ? null : <TicketProblem message={problem} onRetry={retry} readAt={mine?.readAt} />}
    </div>
  );
}

/** The key, the status pill and the title. */
function Header({ ticketKey, ticket }: { ticketKey: string; ticket: Ticket | undefined }) {
  const listed = useMemo(() => (ticket ? [ticket] : []), [ticket]);
  const [row] = useTicketRowModels(listed);

  return (
    <header>
      <div className="flex items-center gap-2.5">
        {ticket?.url ? (
          <a
            className="font-mono text-[12px] font-bold text-brand hover:underline"
            href={ticket.url}
            target="_blank"
            rel="noreferrer"
          >
            {ticketKey}
          </a>
        ) : (
          <span className="font-mono text-[12px] font-bold text-brand">{ticketKey}</span>
        )}
        {ticket ? (
          <TicketTransitionMenu
            issueKey={ticket.key}
            status={ticket.status}
            statusCategory={ticket.statusCategory}
            {...(row?.tone === 'amber' ? { tone: 'amber' as const } : {})}
          />
        ) : null}
      </div>
      {ticket && row ? (
        <h1 className="mt-1 mb-2 text-[19px] leading-[1.3] text-ink">{row.title}</h1>
      ) : (
        <div role="status" aria-label="Loading ticket" aria-busy className="mt-2 mb-3 animate-pulse">
          <SkeletonBar className="w-[60%]" />
        </div>
      )}
    </header>
  );
}

/**
 * One ticket's page (HIVE-203): the header straight from the list (or the
 * issue the slice read), the description, the conversation, and the
 * properties column. Reads on open and every minute after; a status change
 * re-reads what the ticket can become next.
 */
export function TicketPage({ ticketKey }: { ticketKey: string }) {
  const ticket = useOpenTicket(ticketKey);
  const load = useLoadTicketDetail();
  const refresh = useRefreshTicketDetail();
  const reload = useReloadTicketTransitions();

  /*
    The poller before the load: its first sweep runs on mount, and run first it
    finds another key (or none) in the slice and returns at once, so opening a
    ticket reads each part once rather than twice.
  */
  usePagePoller(useCallback(() => refresh(ticketKey), [ticketKey, refresh]));

  useEffect(() => {
    void load(ticketKey);
  }, [ticketKey, load]);

  /*
    The load already read the transitions, so the first run is skipped; every
    later status — from the pill's menu, the next-step action or a refresh of
    the list — re-reads them (D6).
  */
  const status = ticket?.status;
  const seen = useRef(status);
  useEffect(() => {
    if (seen.current === status) return;
    seen.current = status;
    void reload(ticketKey);
  }, [status, ticketKey, reload]);

  return (
    <section aria-label={`Ticket ${ticketKey}`} className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto p-8">
        <Header ticketKey={ticketKey} ticket={ticket} />
        <Description ticketKey={ticketKey} />
      </div>
      <aside className="w-[260px] shrink-0 border-l border-border-soft px-4 py-[18px]" />
    </section>
  );
}

/** The Work place's stage (HIVE-203, D3): the open ticket's page, or a prompt to pick one. */
export function WorkStage() {
  const key = useWorkTicket();

  if (key === null) {
    return (
      <section aria-label="Work" className="flex flex-1 items-center justify-center">
        <p className="text-[13px] text-subtle">Pick a ticket</p>
      </section>
    );
  }

  return <TicketPage key={key} ticketKey={key} />;
}
