import { useEffect, useState } from 'react';

import { JobFlowChart } from '@components/flow/job-flow-chart';
import { JobFlowBuckets, JobFlowEntryCard, JobFlowLegend, JobFlowSummary } from '@components/flow/job-flow-parts';
import { SkeletonBar } from '@features/shared/components/skeleton-bar';
import { SourceProblem } from '@features/shared/components/source-problem';
import type { LedgerJobQuery } from '@shared/ledger-contract';
import { jobKey, useJobEntry, useJobFlow, useLoadJob, useOpenEntity } from '@stores/hive-store';
import { useFlowFocus, useSetFlowFocus } from '@stores/ui-store';

const MINUTE = 60_000;

/**
 * One job's Flow tab (Job Flow): reads the job's history once, merges the
 * live tail, and draws the route, the selected handoff and where the time
 * went. Shared by the ticket page and the PR page, which may not import each
 * other; the chart itself is the fenced `components/flow/`. `query` must be
 * memoised by the caller.
 */
export function JobFlowView({ query, emptyText }: { query: LedgerJobQuery; emptyText: string }) {
  const key = jobKey(query);
  const load = useLoadJob();
  const entry = useJobEntry(key);
  const [now, setNow] = useState(Date.now);
  const flow = useJobFlow(query, now);
  const selected = useFlowFocus(key);
  const setFocus = useSetFlowFocus();
  const openEntity = useOpenEntity();
  const live = flow?.live === true;

  useEffect(() => {
    void load(query);
  }, [load, query]);

  // A live job's "now" moves once a minute without a ledger write.
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, [live]);

  if (entry?.state === 'failed') {
    return (
      <div className="px-6 pt-4">
        <SourceProblem message={entry.problem ?? 'Could not read the ledger.'} onRetry={() => load(query)} />
      </div>
    );
  }
  const warnings = entry?.warnings ?? [];
  const unread = `Some of the ledger could not be read: ${warnings.join(', ')}.`;
  if (flow === null) {
    if (entry === undefined || entry.state === 'loading') {
      return (
        <div role="status" aria-label="Loading the flow" aria-busy className="flex animate-pulse flex-col gap-2 px-6 pt-4">
          <SkeletonBar className="w-[92%]" />
          <SkeletonBar className="w-[84%]" />
          <SkeletonBar className="w-[58%]" />
        </div>
      );
    }
    // Nothing to draw and days that would not read: the history may be in them, so this is not "nothing written".
    return warnings.length === 0 ? (
      <p className="px-6 pt-4 text-ui text-subtle">{emptyText}</p>
    ) : (
      <div className="px-6 pt-4">
        <SourceProblem message={unread} onRetry={() => load(query)} />
      </div>
    );
  }

  const edge = selected === null ? undefined : flow.edges.find((x) => x.id === selected);
  const session =
    edge === undefined ? undefined : [edge.from, edge.to].find((id) => flow.lanes.find((lane) => lane.id === id)?.kind === 'session');

  return (
    <div className="@container grid gap-[18px] px-6 py-4">
      <JobFlowSummary flow={flow} />
      {warnings.length === 0 ? null : (
        <p className="text-ui-sm text-amber-text">{unread}</p>
      )}
      <JobFlowLegend />
      <div className="overflow-x-auto rounded-xl border border-border-soft bg-panel">
        <JobFlowChart flow={flow} selected={selected} onSelect={(id) => setFocus(key, id)} />
      </div>
      <div className="grid gap-[18px] @min-[760px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {edge === undefined ? (
          <p className="text-control text-subtle">Select a handoff to see what was asked and how it closed.</p>
        ) : (
          <JobFlowEntryCard
            edge={edge}
            flow={flow}
            onClear={() => setFocus(key, null)}
            {...(session === undefined ? {} : { onGoTo: () => void openEntity(session) })}
          />
        )}
        <JobFlowBuckets flow={flow} />
      </div>
    </div>
  );
}
