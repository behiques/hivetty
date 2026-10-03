import { Check, Minus, X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { formatDuration } from '@/lib/format-duration';
import { cn } from '@/lib/utils';
import { isSession } from '@/types/entity';
import type { HatcheryRow } from '@/types/pull-request';

import { statusLabel } from '@components/ui/status-dot';
import { Flap } from '@features/pull-requests/components/flap';
import type { PrCheck, PrDetail, PrReview } from '@shared/github-contract';
import { useEntity, useReviewUrls } from '@stores/hive-store';

const HEADING = 'flex items-center pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase';
const CHECK_ROW = 'flex items-center gap-[9px] rounded px-1 py-[5px] text-[12.5px]';

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h2 className={HEADING}>
        {title}
        {aside === undefined ? null : <span className="ml-auto tracking-normal normal-case">{aside}</span>}
      </h2>
      {children}
    </div>
  );
}

function CheckIcon({ status }: { status: PrCheck['status'] }) {
  if (status === 'success') return <Check size={14} data-check="success" aria-hidden className="text-green" />;
  if (status === 'failure') return <X size={14} data-check="failure" aria-hidden className="text-red" />;
  if (status === 'neutral') return <Minus size={14} data-check="neutral" aria-hidden className="text-subtle" />;
  return (
    <span
      data-check={status}
      aria-hidden
      className={cn(
        'mx-px size-3 rounded-full border-2',
        status === 'running' ? 'border-green motion-safe:animate-ccpulse' : 'border-dashed border-subtle',
      )}
    />
  );
}

const took = (check: PrCheck) =>
  check.startedAt !== null && check.completedAt !== null
    ? formatDuration(Date.parse(check.completedAt) - Date.parse(check.startedAt))
    : '';

const VERDICT: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
};

/** A pending review has no `submittedAt`; it sorts last, so it is the latest. */
const submitted = (review: PrReview) => (review.submittedAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(review.submittedAt));

/** The latest review per author, then anyone requested who has not reviewed. */
function reviewers(detail: PrDetail, viaHive: ReadonlySet<string>): { who: string; verdict: string }[] {
  const latest = new Map<string, PrReview>();
  for (const review of [...detail.reviews].sort((a, b) => submitted(a) - submitted(b))) {
    latest.set(viaHive.has(review.url) ? 'acr' : (review.author ?? 'ghost'), review);
  }
  const done = [...latest].map(([who, review]) => ({ who, verdict: VERDICT[review.state] ?? review.state.toLowerCase() }));
  const asked = detail.reviewRequests.filter((who) => !latest.has(who)).map((who) => ({ who, verdict: 'requested' }));
  return [...done, ...asked];
}

function CheckRow({ check }: { check: PrCheck }) {
  const body = (
    <>
      <CheckIcon status={check.status} />
      <span className="font-mono text-ink">{check.name}</span>
      <span className="flex-1" />
      <span className="font-mono text-[11.5px] text-muted">{took(check)}</span>
    </>
  );
  /* A StatusContext may carry no page; then there is nothing to open. */
  if (check.url === null) return <div className={CHECK_ROW}>{body}</div>;
  return (
    <a href={check.url} target="_blank" rel="noreferrer" className={cn(CHECK_ROW, 'hover:bg-hover')}>
      {body}
    </a>
  );
}

/**
 * The PR page's right column (HIVE-205): status, checks, reviewers, the linked
 * ticket and the actions. A check opens its page on GitHub until HIVE-206's
 * Checks tab exists (D20). A section with nothing to say is left out.
 */
export function PrProperties({
  row,
  detail,
  actions,
}: {
  row: HatcheryRow;
  detail: PrDetail | undefined;
  actions?: ReactNode;
}) {
  const { pr, hatch } = row;
  const viaHive = useReviewUrls();
  const entity = useEntity(pr.session ?? '');
  const session = entity !== undefined && isSession(entity) ? entity : null;
  const failing = detail?.checks.filter((check) => check.status === 'failure').length ?? 0;
  const people = detail === undefined ? [] : reviewers(detail, viaHive);

  return (
    <div className="flex flex-col gap-1.5">
      <Section title="Status">
        <div className="flex flex-col items-start gap-1.5 px-1 pt-0.5 pb-1.5 text-[12px]">
          <Flap hatch={hatch} />
          <span className="text-muted">{hatch.github}</span>
        </div>
      </Section>

      {detail !== undefined && detail.checks.length > 0 ? (
        <Section
          title="Checks"
          aside={
            failing > 0 ? (
              <span className="font-mono text-[12px] font-semibold text-red">{`${String(failing)} failing`}</span>
            ) : undefined
          }
        >
          {detail.checks.map((check, i) => (
            <CheckRow key={`${check.name}-${String(i)}`} check={check} />
          ))}
        </Section>
      ) : null}

      {people.length > 0 ? (
        <Section title="Reviewers">
          {people.map(({ who, verdict }) => (
            <div key={who} className="flex items-baseline gap-2 px-1 py-1 text-[12.5px]">
              <span className="font-semibold text-ink">{who}</span>
              <span className="text-muted">{verdict}</span>
            </div>
          ))}
        </Section>
      ) : null}

      {session !== null ? (
        <Section title="Linked">
          <div className="flex items-baseline gap-2 px-1 py-1 text-[12.5px]">
            {session.ticket === undefined ? null : <span className="font-mono text-brand">{session.ticket}</span>}
            <span className="text-muted">{`session ${statusLabel(session.status, session.idleDetail)}`}</span>
          </div>
        </Section>
      ) : null}

      {actions === undefined ? null : <Section title="Actions">{actions}</Section>}
    </div>
  );
}
