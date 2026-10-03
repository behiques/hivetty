import { useCallback } from 'react';

import { createPoller } from '@/hooks/create-poller';
import type { HatcheryRow, SessionPr } from '@/types/pull-request';

import { Flap } from '@features/pull-requests/components/flap';
import { CheckRow, Section } from '@features/pull-requests/components/pr-properties';
import { checkCount } from '@features/pull-requests/session-pr';
import { SkeletonBar } from '@features/shared/components/skeleton-bar';
import { SourceProblem } from '@features/shared/components/source-problem';
import { prKey, type SessionPrRow, useLoadPrDetail, usePrDetail } from '@stores/hive-store';
import { usePrPageActions } from '@stores/ui-store';

/** The tab's detail re-reads once a minute while it is shown; mounting is the first read (PrPage's rule). */
const useTabPoller = createPoller({ intervalMs: 60_000 });

const LINK = 'px-1 py-1 text-left text-[12.5px] text-brand hover:underline';

function Foot({ url, onShow }: { url: string; onShow?: () => void }) {
  return (
    <div className="mt-2.5 flex flex-col gap-0.5 border-t border-border-soft pt-2">
      <a href={url} target="_blank" rel="noreferrer" className={LINK}>
        Open on GitHub ›
      </a>
      {onShow === undefined ? null : (
        <button type="button" onClick={onShow} className={LINK}>
          Show in PRs ›
        </button>
      )}
    </div>
  );
}

/** A PR the sweep cannot see now: its number and link, and nothing that would need a read. */
function Remembered({ pr }: { pr: SessionPr }) {
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      <span className="px-1 font-mono text-[11.5px] text-muted">{`#${String(pr.n)} · last seen`}</span>
      <p className="px-1 text-muted">This PR isn&apos;t in the current sweep, so its checks and reviews can&apos;t be read here.</p>
      <Foot url={pr.url} />
    </div>
  );
}

function LivePr({ row }: { sessionId: string; row: HatcheryRow }) {
  const { pr, hatch } = row;
  const entry = usePrDetail(prKey(pr.owner, pr.repo, pr.n));
  const load = useLoadPrDetail();
  const { openPrPage } = usePrPageActions();
  const detail = entry?.detail;

  useTabPoller(useCallback(() => load(pr.owner, pr.repo, pr.n), [load, pr.owner, pr.repo, pr.n]));

  const count = detail === undefined ? null : checkCount(detail.checks);

  return (
    <div className="flex flex-col text-[12.5px]">
      <span data-testid="session-pr-sub" className="flex items-center gap-1.5 px-1 font-mono text-[11.5px] text-muted">
        {`#${String(pr.n)} · `}
        <Flap hatch={hatch} />
        {` · ${pr.state}`}
      </span>
      <p className="px-1 pt-2 pb-1 text-[14px] leading-snug font-bold text-ink">{pr.title}</p>
      <span data-testid="session-pr-facts" className="px-1 font-mono text-[11.5px] break-all text-muted">
        {detail === undefined ? (
          pr.branch
        ) : (
          <>
            {detail.baseRef === null ? (detail.headRef ?? pr.branch) : `${detail.headRef ?? pr.branch} → ${detail.baseRef}`}
            {' · '}
            <span className="text-green">{`+${String(detail.additions)}`}</span>{' '}
            <span className="text-red">{`−${String(detail.deletions)}`}</span>
            {` · ${String(detail.changedFiles)} ${detail.changedFiles === 1 ? 'file' : 'files'}`}
          </>
        )}
      </span>

      {detail === undefined ? (
        entry?.state === 'failed' ? (
          <div className="pt-3">
            <SourceProblem
              message={entry.problem ?? 'Could not read this pull request.'}
              onRetry={() => void load(pr.owner, pr.repo, pr.n)}
            />
          </div>
        ) : (
          <div role="status" aria-label="Loading pull request" aria-busy className="flex animate-pulse flex-col gap-2 pt-3">
            <SkeletonBar className="w-[84%]" />
            <SkeletonBar className="w-[58%]" />
          </div>
        )
      ) : (
        <Section title={count === null || count.total === 0 ? 'Checks' : `Checks ${String(count.done)} of ${String(count.total)}`}>
          {detail.checks.length === 0 ? (
            <p className="px-1 py-1 text-muted">No checks yet</p>
          ) : (
            detail.checks.map((check, i) => <CheckRow key={`${check.name}-${String(i)}`} check={check} />)
          )}
        </Section>
      )}

      <Foot url={pr.url} onShow={() => openPrPage({ owner: pr.owner, repo: pr.repo, n: pr.n, row })} />
    </div>
  );
}

/**
 * The session panel's PR tab (HIVE-209): the PR this session made, its checks
 * by name, who holds it and its open threads, read through HIVE-205's per-PR
 * detail while the tab is shown. A remembered PR has no owner or repo, so it
 * gets its number and link only.
 */
export function SessionPrTab({ sessionId, sessionPr }: { sessionId: string; sessionPr: SessionPrRow }) {
  if (sessionPr.row === null) return <Remembered pr={sessionPr.pr} />;
  return <LivePr sessionId={sessionId} row={sessionPr.row} />;
}
