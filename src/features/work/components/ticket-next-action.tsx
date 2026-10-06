import { CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';

import { applyJiraTransition } from '@/lib/jira';
import { BRIDGE_ERROR } from '@/lib/utils';

import {
  useNextTransition,
  useReloadTicketTransitions,
  useSetTicketDetailIssue,
  useUpdateTicket,
} from '@stores/hive-store';

/**
 * "Move to <status>": the one step forward (HIVE-203, D6), shared by the
 * ticket page's properties and the session panel's Ticket tab (HIVE-202). The
 * re-read issue goes to both homes a ticket can have — the list, and the
 * slice's own `issue` for one the list does not hold; each ignores a ticket
 * that is not its own. A refusal says why under the button and keeps it.
 */
export function TicketNextAction({ ticketKey, className }: { ticketKey: string; className?: string }) {
  const next = useNextTransition(ticketKey);
  const updateTicket = useUpdateTicket();
  const setIssue = useSetTicketDetailIssue();
  const reload = useReloadTicketTransitions();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!next) return null;

  const apply = () => {
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

  return (
    <div className="flex flex-col">
      <button type="button" className={className} onClick={apply} disabled={busy}>
        <CaretRight size={13} aria-hidden />
        {`Move to ${next.to.name}`}
      </button>
      {problem === null ? null : <p className="py-1 text-[12px] text-amber-text">{problem}</p>}
    </div>
  );
}
