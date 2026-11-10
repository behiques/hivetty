import { ArrowSquareOut, Kanban } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef } from 'react';

import { createPoller } from '@/hooks/create-poller';
import { parseTitleTags } from '@/lib/ticket-tags';
import { cn } from '@/lib/utils';

import { AdfBlocks } from '@features/work/components/adf-blocks';
import { TicketLinks } from '@features/work/components/ticket-links-section';
import { TicketNextAction } from '@features/work/components/ticket-next-action';
import { LinesSkeleton, Section, TicketProblem } from '@features/work/components/ticket-page-parts';
import { CATEGORY_TEXT, commentTime, STATUS_PILL } from '@features/work/ticket-presentation';
import {
  useLatestComment,
  useLoadTicketDetail,
  useOpenTicket,
  useRefreshTicketDetail,
  useSessionPr,
  useTicketCriteria,
  useTicketDetail,
  useTicketSource,
} from '@stores/hive-store';
import { useOpenWorkTicket } from '@stores/ui-store';

/** The tab re-reads once a minute while it is the visible tab (HIVE-202, D4). */
const useTabPoller = createPoller({ intervalMs: 60_000 });

/** One action per line, as the Work page's Actions list draws them, so a long status never squeezes a neighbour. */
const ACTION = 'flex items-center gap-2 py-1 text-left text-control text-brand hover:underline disabled:opacity-60';

function Criteria({ ticketKey }: { ticketKey: string }) {
  const criteria = useTicketCriteria(ticketKey);
  if (criteria === null) return null;
  if (criteria.kind === 'description') {
    return (
      <Section title="Description">
        <div className="flex flex-col gap-2 text-control">
          <AdfBlocks blocks={criteria.blocks} />
        </div>
      </Section>
    );
  }
  return (
    <Section title="Acceptance criteria" count={criteria.items.length}>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-control text-ink">
        {criteria.items.map((runs, i) => (
          <li key={i}>{runs.map((one) => one.text).join('')}</li>
        ))}
      </ul>
    </Section>
  );
}

function LatestComment({ ticketKey }: { ticketKey: string }) {
  const comment = useLatestComment(ticketKey);
  if (comment === undefined) return null;
  return (
    <Section title="Latest comment">
      <p className="text-ui-sm font-semibold text-ink">{`${comment.author} · ${commentTime(comment.created)}`}</p>
      <div className="flex flex-col gap-1.5 text-control text-muted">
        <AdfBlocks blocks={comment.body} />
      </div>
    </Section>
  );
}

/**
 * The session panel's Ticket tab (HIVE-202): what was asked for, beside what
 * the session says it did. Reads the ticket with its links on mount and once a
 * minute while mounted; the panel mounts only the visible tab.
 */
export function TicketTab({ ticketKey, sessionId }: { ticketKey: string; sessionId: string }) {
  const ticket = useOpenTicket(ticketKey);
  const entry = useTicketDetail(ticketKey);
  const source = useTicketSource();
  const load = useLoadTicketDetail();
  const refresh = useRefreshTicketDetail();
  const openOnWork = useOpenWorkTicket();
  const pr = useSessionPr(sessionId);

  /*
    As on the ticket page: the load does the first read of a key, the poller
    only the later ones. Its sweep on mount runs before the load's effect and is
    skipped, so a key the map already holds is read once on open, not twice.
  */
  const loaded = useRef<string | null>(null);
  useTabPoller(
    useCallback(
      () => (loaded.current === ticketKey ? refresh(ticketKey) : Promise.resolve()),
      [ticketKey, refresh],
    ),
  );
  useEffect(() => {
    loaded.current = ticketKey;
    void load(ticketKey, 'tab');
  }, [ticketKey, load]);

  const retry = () => void load(ticketKey, 'tab');
  const problem = entry?.problems.detail ?? entry?.problems.comments;
  const nothing = ticket === undefined && entry?.detail === undefined;

  if (nothing && source.kind === 'unconfigured') {
    return <p className="px-1 py-3 text-control text-muted">Jira is not connected.</p>;
  }
  if (nothing && problem === undefined) return <LinesSkeleton label="Loading ticket" />;

  return (
    <div className="flex flex-col gap-4 px-1 pt-1 pb-3">
      <header className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-1.5 text-ui-sm text-muted">
          <span className="tabular-nums font-bold text-brand">{ticketKey}</span>
          {ticket?.issueType ? <span>{`· ${ticket.issueType} ·`}</span> : <span>·</span>}
          {ticket ? (
            <span className={cn(STATUS_PILL, CATEGORY_TEXT[ticket.statusCategory])}>{ticket.status}</span>
          ) : null}
        </p>
        {ticket ? (
          <h2 className="text-ui-lg leading-snug font-semibold text-ink">{parseTitleTags(ticket.title).title}</h2>
        ) : null}
      </header>
      {problem === undefined ? null : <TicketProblem message={problem} onRetry={retry} readAt={entry?.readAt} />}
      <Criteria ticketKey={ticketKey} />
      <LatestComment ticketKey={ticketKey} />
      <TicketLinks ticketKey={ticketKey} pr={pr?.n ?? null} />
      <Section title="Actions">
        <div className="flex flex-col items-start">
          <TicketNextAction ticketKey={ticketKey} className={ACTION} />
          <button type="button" className={ACTION} onClick={() => openOnWork(ticketKey)}>
            <Kanban size={13} aria-hidden />
            Open the ticket
          </button>
          {ticket?.url ? (
            <a className={ACTION} href={ticket.url} target="_blank" rel="noreferrer">
              <ArrowSquareOut size={13} aria-hidden />
              Open in Jira
            </a>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
