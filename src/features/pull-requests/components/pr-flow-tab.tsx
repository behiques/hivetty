import { useMemo } from 'react';

import type { Pr } from '@/types/pull-request';

import { JobFlowView } from '@features/shared/components/job-flow-view';
import type { LedgerJobQuery } from '@shared/ledger-contract';

/** The PR's Flow tab (Job Flow): seeded by the PR; its ticket, and that ticket's other PRs, are found from the entries. */
export function PrFlowTab({ pr }: { pr: Pick<Pr, 'owner' | 'repo' | 'n'> }) {
  const query = useMemo<LedgerJobQuery>(
    () => ({ prs: [{ repo: `${pr.owner}/${pr.repo}`, n: pr.n }] }),
    [pr.owner, pr.repo, pr.n],
  );
  return <JobFlowView query={query} emptyText={`No agent or session has written about #${String(pr.n)} yet.`} />;
}
