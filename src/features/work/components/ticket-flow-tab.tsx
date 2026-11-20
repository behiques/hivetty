import { useMemo } from 'react';

import { JobFlowView } from '@features/shared/components/job-flow-view';
import type { LedgerJobQuery } from '@shared/ledger-contract';

/** The ticket's Flow tab (Job Flow): seeded by the key; its PRs are found from what the entries name. */
export function TicketFlowTab({ ticketKey }: { ticketKey: string }) {
  const query = useMemo<LedgerJobQuery>(() => ({ ticket: ticketKey, prs: [] }), [ticketKey]);
  return <JobFlowView query={query} emptyText={`No agent or session has written about ${ticketKey} yet.`} />;
}
