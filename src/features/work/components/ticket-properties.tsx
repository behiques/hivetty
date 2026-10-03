import { ArrowSquareOut, CaretRight, Hexagon } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { applyJiraTransition } from '@/lib/jira';
import { BRIDGE_ERROR, cn } from '@/lib/utils';

import { TicketPrRow } from '@features/work/components/ticket-pr-row';
import { TicketSessionRow } from '@features/work/components/ticket-session-row';
import {
  useNextTransition,
  useOpenTicket,
  useReloadTicketTransitions,
  useSetTicketDetailIssue,
  useTicketPrs,
  useTicketProperties,
  useTicketSessions,
  useUpdateTicket,
} from '@stores/hive-store';
import { usePickerActions } from '@stores/ui-store';

const HEADING = 'pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase';
const ACTION = 'flex items-center gap-2 py-1.5 text-left text-[12.5px] text-brand hover:underline disabled:opacity-60';

function Heading({ children }: { children: ReactNode }) {
  return <h2 className={HEADING}>{children}</h2>;
}

/**
 * The ticket page's right column (HIVE-203): its key/values, the sessions and
 * pull requests on it, and what can be done next. A row with no value is left
 * out rather than drawn empty; Assignee alone always shows, as `Unassigned`.
 */
export function TicketProperties({ ticketKey }: { ticketKey: string }) {
  const ticket = useOpenTicket(ticketKey);
  const properties = useTicketProperties(ticketKey);
  const sessions = useTicketSessions(ticketKey);
  const prs = useTicketPrs(ticketKey);
  const next = useNextTransition(ticketKey);
  const updateTicket = useUpdateTicket();
  const setIssue = useSetTicketDetailIssue();
  const reload = useReloadTicketTransitions();
  const { openPicker } = usePickerActions();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (ticket === undefined || properties === undefined) return null;

  /*
    The re-read issue goes to both homes a ticket can have — the list, and the
    slice's own `issue` for one the list does not hold. Each ignores a ticket
    that is not its own, so calling both is the whole decision.
  */
  const apply = () => {
    if (!next) return;
    setBusy(true);
    setProblem(null);
    void applyJiraTransition({ key: ticketKey, transitionId: next.id }).then((result) => {
      setBusy(false);
      if (result === null) return setProblem(BRIDGE_ERROR);
      if (!result.ok) return setProblem(result.error.message);
      updateTicket(result.value);
      setIssue(result.value);
      void reload(ticketKey);
    });
  };

  const rows: [string, string | undefined, string?][] = [
    ['Status', properties.status],
    ['Priority', properties.priority],
    ['Side', properties.side],
    ['Project', properties.project],
    ['Assignee', properties.assignee],
    ['Agent', properties.agent],
    ['Epic', properties.epic, 'font-mono'],
  ];

  return (
    <div className="flex flex-col">
      <dl className="grid grid-cols-[84px_1fr] gap-x-2.5 gap-y-[9px] text-[12.5px]">
        {rows.map(([key, text, extra]) =>
          text === undefined ? null : (
            <div key={key} className="contents">
              <dt className="text-muted">{key}</dt>
              <dd className={cn('min-w-0 truncate font-medium text-ink', extra)}>{text}</dd>
            </div>
          ),
        )}
      </dl>

      {sessions.length > 0 ? (
        <>
          <Heading>Session</Heading>
          {sessions.map((id) => (
            <TicketSessionRow key={id} id={id} />
          ))}
        </>
      ) : null}

      {prs.length > 0 ? (
        <>
          <Heading>Pull request</Heading>
          {prs.map((pr) => (
            <TicketPrRow key={`${pr.repo}#${pr.n}`} pr={pr} />
          ))}
        </>
      ) : null}

      <Heading>Actions</Heading>
      <button type="button" className={ACTION} onClick={() => openPicker(ticketKey)}>
        <Hexagon size={13} aria-hidden />
        New session
      </button>
      {next ? (
        <button type="button" className={ACTION} onClick={apply} disabled={busy}>
          <CaretRight size={13} aria-hidden />
          {`Move to ${next.to.name}`}
        </button>
      ) : null}
      {problem === null ? null : <p className="py-1 text-[12px] text-amber">{problem}</p>}
      {ticket.url ? (
        <a className={ACTION} href={ticket.url} target="_blank" rel="noreferrer">
          <ArrowSquareOut size={13} aria-hidden />
          Open in Jira
        </a>
      ) : null}
    </div>
  );
}
